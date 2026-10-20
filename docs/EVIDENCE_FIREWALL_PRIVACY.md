# Evidence Decision Firewall - privacy boundary

The HTTP adapter exposes only a coarse conclusion. It never returns raw evidence, private field values, evidence IDs,
contradiction details, internal reason codes or the Passport snapshot.

Authorization failures for otherwise valid conclusion requests have the same `200` response shape and
`NOT_DISCLOSABLE` result. Malformed request bodies return `400`; infrastructure failures return `503` without a
verdict. Existing Trust View and guest redemption status/error contracts are unchanged.

The pure engine conservatively withholds positive conclusions when an approved-but-hidden contradiction or an
impossible-provenance snapshot record is encountered. The adapter maps that condition to `NOT_CONFIRMED`, the same
coarse result used for ordinary insufficiency. This avoids naming hidden corruption but does not claim perfect
noninterference: repeated observations may still reveal state changes across pinned versions, expiry or revocation.

Guest tokens are hashed for lookup and the request logger redacts raw, encoded and malformed guest paths. No token is
included in an error message, response or audit metadata.
