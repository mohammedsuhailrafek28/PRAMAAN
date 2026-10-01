import { useNavigate } from "react-router-dom";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  FileCheck2,
  Fingerprint,
  Landmark,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const delays = [
  ["Supplier Onboarding", "18 Days"],
  ["Loan Verification", "11 Days"],
  ["Vendor Verification", "21 Days"],
  ["Tender Approval", "16 Days"],
];

const fragments = [
  { label: "GST", x: "-24vw", y: "-9rem", delay: 0.1 },
  { label: "PAN", x: "21vw", y: "-8rem", delay: 0.18 },
  { label: "Udyam", x: "-28vw", y: "6rem", delay: 0.26 },
  { label: "Bank", x: "25vw", y: "8rem", delay: 0.34 },
  { label: "Compliance", x: "-8vw", y: "12rem", delay: 0.42 },
  { label: "Buyer", x: "10vw", y: "-13rem", delay: 0.5 },
];

const approvedFields = ["Legal name", "GSTIN", "Udyam", "Compliance"];

function NoiseLayer() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-[0.06]"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)",
        backgroundSize: "18px 18px",
      }}
    />
  );
}

function TrustCardVisual({ revoked = false, compact = false }: { revoked?: boolean; compact?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 26, rotateX: 12 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
      viewport={{ once: true, amount: 0.45 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "relative overflow-hidden rounded-[2rem] border border-white/15 bg-white/[0.08] shadow-[0_30px_120px_rgba(37,99,235,0.28)] backdrop-blur-2xl",
        compact ? "w-full max-w-md p-5" : "w-full max-w-xl p-6 sm:p-7"
      )}
    >
      <div className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />
      <div className="absolute -right-20 -top-24 h-56 w-56 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="absolute -bottom-28 -left-24 h-64 w-64 rounded-full bg-blue-700/25 blur-3xl" />

      <motion.div
        animate={revoked ? { filter: "blur(6px)", opacity: 0.34, scale: 0.985 } : { filter: "blur(0px)", opacity: 1 }}
        transition={{ duration: 0.45 }}
        className="relative"
      >
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.28em] text-cyan-200/80">
              <ShieldCheck className="h-4 w-4" />
              Trust Card
            </div>
            <h3 className="mt-4 max-w-sm text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Sharma Textiles Pvt. Ltd.
            </h3>
            <p className="mt-2 text-sm text-slate-300">Evidence-backed, consent-controlled Trust Card</p>
          </div>

        </div>

        <div className="mt-8 grid grid-cols-2 gap-3">
          {[
            ["GSTIN", "Cross-checked"],
            ["Udyam", "Cross-checked"],
            ["Bank evidence", "Submitted"],
            ["Freshness", "Current"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</p>
              <p className="mt-2 truncate text-sm font-medium text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 text-xs text-slate-300">
          <span>Generated 09 Jul 2026</span>
          <span>Version 02</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-emerald-200">
            <BadgeCheck className="h-3.5 w-3.5" />
            Consent active
          </span>
        </div>
      </motion.div>

      {revoked && (
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/62 px-6 text-center backdrop-blur-md"
        >
          <LockKeyhole className="h-9 w-9 text-red-200" />
          <p className="mt-4 text-2xl font-semibold text-white">Access Revoked</p>
          <p className="mt-2 text-sm text-slate-300">Request Fresh Consent</p>
        </motion.div>
      )}
    </motion.div>
  );
}

function OpeningSequence() {
  return (
    <section className="relative flex min-h-screen items-center overflow-hidden px-6 py-24">
      <NoiseLayer />
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="min-w-0">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="text-xs font-medium uppercase tracking-[0.24em] text-cyan-200/80 sm:text-sm sm:tracking-[0.32em]"
          >
            The hidden tax on Indian MSMEs
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 text-4xl font-semibold tracking-tight text-slate-50 sm:text-7xl lg:text-7xl"
          >
            <span className="block">Trust should not</span>
            <span className="block">restart every time</span>
            <span className="block">business begins.</span>
          </motion.h1>
        </div>

        <div className="space-y-4">
          {delays.map(([label, time]) => (
            <div
              key={label}
              className="flex min-w-0 flex-col items-start justify-between gap-2 rounded-3xl border border-white/15 bg-white/[0.1] px-4 py-5 shadow-[0_20px_80px_rgba(15,23,42,0.35)] backdrop-blur-xl sm:flex-row sm:items-center sm:gap-4 sm:px-5"
            >
              <span className="min-w-0 truncate text-sm text-slate-200 sm:text-base">{label}</span>
              <span className="shrink-0 text-xl font-semibold tracking-tight text-white sm:text-2xl">{time}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhySequence() {
  return (
    <section className="relative flex min-h-[92vh] items-center justify-center px-6 py-24 text-center">
      <div className="mx-auto max-w-5xl">
        {["One Business.", "Four Different Verifications.", "Why?"].map((line, index) => (
          <motion.h2
            key={line}
            initial={{ opacity: 0, y: 22 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.75 }}
            transition={{ delay: index * 0.18, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "text-5xl font-semibold tracking-tight sm:text-7xl",
              index === 2 ? "mt-8 text-cyan-200" : "text-white"
            )}
          >
            {line}
          </motion.h2>
        ))}
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.62, duration: 0.75 }}
          className="mx-auto mt-12 max-w-3xl text-3xl font-semibold tracking-tight text-slate-300 sm:text-5xl"
        >
          Every Business Starts With Zero Trust.
        </motion.p>
      </div>
    </section>
  );
}

function AssemblySequence() {
  return (
    <section className="relative min-h-screen overflow-hidden px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          className="mx-auto max-w-3xl text-center"
        >
          <p className="text-sm font-medium uppercase tracking-[0.32em] text-cyan-200/80">Pramaan assembles trust</p>
          <h2 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            Scattered proofs become one portable trust profile.
          </h2>
        </motion.div>

        <div className="relative mt-24 flex min-h-[520px] items-center justify-center">
          {fragments.map((fragment) => (
            <motion.div
              key={fragment.label}
              initial={{ opacity: 0, x: fragment.x, y: fragment.y, rotate: -8 }}
              whileInView={{
                opacity: [0, 1, 1, 0.18],
                x: [fragment.x, fragment.x, "0vw"],
                y: [fragment.y, fragment.y, "0rem"],
                rotate: [-8, 3, 0],
              }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ delay: fragment.delay, duration: 1.9, times: [0, 0.35, 1], ease: [0.22, 1, 0.36, 1] }}
              className="absolute rounded-2xl border border-white/12 bg-white/[0.08] px-5 py-3 text-sm font-medium text-white shadow-2xl backdrop-blur-xl"
            >
              {fragment.label}
            </motion.div>
          ))}
          <TrustCardVisual />
        </div>
      </div>
    </section>
  );
}

function ConsentSequence() {
  const steps = [
    { icon: Building2, title: "Buyer requests access", body: "No PDF. No email attachment. Just a field-level request." },
    { icon: Fingerprint, title: "MSME approves selected fields", body: "Legal name, GSTIN, Udyam and compliance only." },
    { icon: FileCheck2, title: "Trust Profile unlocks", body: "The buyer sees exactly what was approved." },
    { icon: RotateCcw, title: "MSME revokes", body: "The same view is cut off instantly." },
  ];

  return (
    <section className="relative overflow-hidden px-6 py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.32em] text-cyan-200/80">Consent is the product</p>
          <h2 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            Access is granted live. And revoked live.
          </h2>
          <div className="mt-10 space-y-4">
            {steps.map((step, index) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, x: -18 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.55 }}
                transition={{ delay: index * 0.12, duration: 0.55 }}
                className="flex gap-4 rounded-3xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-300/10 text-cyan-200">
                  <step.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-medium text-white">{step.title}</h3>
                  <p className="mt-1 text-sm text-slate-400">{step.body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 backdrop-blur-xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">Acme Retail Buyers</p>
                <p className="text-xs text-slate-400">Requests Trust Profile fields</p>
              </div>
              <span className="rounded-full bg-amber-300/10 px-3 py-1 text-xs text-amber-200">Pending</span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {approvedFields.concat("Bank status").map((field, index) => (
                <span
                  key={field}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    index < approvedFields.length
                      ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                      : "border-white/10 bg-white/5 text-slate-400 line-through"
                  )}
                >
                  {field}
                </span>
              ))}
            </div>
          </motion.div>

          <TrustCardVisual compact />
          <TrustCardVisual compact revoked />
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  const navigate = useNavigate();
  const { scrollYProgress } = useScroll();
  const backgroundY = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);

  return (
    <div className="min-h-screen overflow-hidden bg-[#02040a] text-white">
      <motion.div
        aria-hidden="true"
        style={{ y: backgroundY }}
        className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.22),transparent_34%),radial-gradient(circle_at_75%_25%,rgba(37,99,235,0.16),transparent_30%),linear-gradient(180deg,#02040a_0%,#06101e_45%,#02040a_100%)]"
      />

      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-slate-950/45 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button className="flex items-center gap-3" onClick={() => navigate("/")}>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-sm font-semibold text-white shadow-lg">
              P
            </span>
            <span className="text-sm font-semibold tracking-tight text-white">Pramaan</span>
          </button>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              className="text-slate-200 hover:bg-white/10 hover:text-white"
              onClick={() => navigate("/login")}
            >
              Log in
            </Button>
            <Button className="hidden bg-white text-slate-950 hover:bg-cyan-100 sm:inline-flex" onClick={() => navigate("/register?role=msme")}>
              Start demo
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <OpeningSequence />
      <WhySequence />

      <section className="relative px-6 py-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.45 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto max-w-5xl"
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-200/10 text-cyan-100">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="mt-8 text-5xl font-semibold tracking-tight text-white sm:text-7xl">
            Pramaan turns business identity into reusable trust.
          </h2>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-slate-300">
            Build evidence once. Share only what is needed. Revoke whenever trust should end.
          </p>
        </motion.div>
      </section>

      <AssemblySequence />
      <ConsentSequence />

      <section className="px-6 py-28 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mx-auto max-w-4xl"
        >
          <p className="text-sm font-medium uppercase tracking-[0.32em] text-cyan-200/80">For India's MSME trust layer</p>
          <h2 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            Reusable business trust. Controlled by the business.
          </h2>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" className="bg-white text-slate-950 hover:bg-cyan-100" onClick={() => navigate("/register?role=msme")}>
              <Building2 className="h-4 w-4" />
              Start as MSME
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              onClick={() => navigate("/register?role=buyer")}
            >
              <Landmark className="h-4 w-4" />
              Request MSME information
            </Button>
          </div>
        </motion.div>
      </section>

      <footer className="border-t border-white/10 px-6 py-8 text-center text-xs text-slate-500">
        Pramaan demo. Representative data only. Pramaan cross-checks submitted evidence internally and does not query GST, Udyam, or bank systems. No lending, credit scoring, blockchain, or AI.
      </footer>
    </div>
  );
}
