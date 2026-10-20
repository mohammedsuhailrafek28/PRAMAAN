"""Resource guards for the extraction worker.

The worker parses untrusted files. Node enforces a wall-clock timeout and an output cap from outside; this module adds
what the worker can enforce on itself:

* no network (defence in depth: sockets raise. This is not a security boundary; run the worker without network access);
* a hard memory cap and "no child processes" through a Windows Job Object, or RLIMIT_CPU / RLIMIT_AS on POSIX;
* a cooperative working-set check between pages on every platform.
"""
from __future__ import annotations

import socket
import sys


class LimitExceeded(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def block_network() -> None:
    def refuse(*_args, **_kwargs):
        raise OSError("network access is disabled in the extraction worker")

    socket.socket.connect = refuse  # type: ignore[assignment]
    socket.socket.connect_ex = refuse  # type: ignore[assignment]
    socket.getaddrinfo = refuse  # type: ignore[assignment]
    socket.create_connection = refuse  # type: ignore[assignment]


if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _psapi = ctypes.WinDLL("psapi", use_last_error=True)
    _kernel32.GetCurrentProcess.restype = wintypes.HANDLE

    class _Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD), ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]

    _psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(_Counters), wintypes.DWORD]

    def _counters() -> "_Counters":
        counters = _Counters()
        counters.cb = ctypes.sizeof(_Counters)
        _psapi.GetProcessMemoryInfo(_kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb)
        return counters

    def current_working_set_mb() -> float:
        return _counters().WorkingSetSize / (1024 * 1024)

    def peak_working_set_mb() -> float:
        return _counters().PeakWorkingSetSize / (1024 * 1024)

    class _Basic(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64), ("LimitFlags", wintypes.DWORD),
                    ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class _Io(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class _Extended(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", _Basic), ("IoInfo", _Io), ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    _kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    _kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
    _kernel32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]
    _kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
else:
    def current_working_set_mb() -> float:
        try:
            import resource

            usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            return usage / (1024 * 1024) if sys.platform == "darwin" else usage / 1024
        except Exception:
            return 0.0

    peak_working_set_mb = current_working_set_mb


def apply_hard_limits(max_memory_mb: int, cpu_seconds: int) -> str:
    """Applies what the platform allows and returns a description of what was actually enforced."""
    enforced = []
    if sys.platform == "win32":
        try:
            job = _kernel32.CreateJobObjectW(None, None)
            info = _Extended()
            info.BasicLimitInformation.LimitFlags = 0x0100 | 0x2000 | 0x0008  # PROCESS_MEMORY | KILL_ON_JOB_CLOSE | ACTIVE_PROCESS
            info.BasicLimitInformation.ActiveProcessLimit = 1
            info.ProcessMemoryLimit = max_memory_mb * 1024 * 1024
            if job and _kernel32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)) and _kernel32.AssignProcessToJobObject(job, _kernel32.GetCurrentProcess()):
                enforced += [f"job-object memory cap {max_memory_mb} MB", "no child processes"]
        except Exception:
            pass
    else:
        try:
            import resource

            # CPU seconds add up across threads (OCR runs several), so the backstop is per-core budget x 4; the wall-clock
            # limit enforced by the caller and the cooperative time budget are the primary bounds.
            cpu_seconds *= 4
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 5))
            enforced.append(f"RLIMIT_CPU {cpu_seconds}s")
            # Address space is a blunt backstop for ML libraries (thread stacks and arenas are reserved, not resident), so it is
            # generous; the real memory ceiling is the container's cgroup limit or the Windows Job Object.
            budget = max(max_memory_mb * 1024 * 1024 * 6, 8 * 1024 ** 3)
            resource.setrlimit(resource.RLIMIT_AS, (budget, budget))
            enforced.append("RLIMIT_AS (backstop, >= 8 GB)")
        except Exception:
            pass
    enforced.append("network sockets blocked in-process")
    return ", ".join(enforced)


def check_memory(max_memory_mb: int) -> None:
    if current_working_set_mb() > max_memory_mb:
        raise LimitExceeded("MEMORY_LIMIT")
