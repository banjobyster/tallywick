# Privacy

tallywick keeps counts. It does not build visitor profiles, and it does not set
cookies.

## What is stored

- One integer per counter, with a created and updated timestamp.
- In a dedup mode, one short lived row per counted visitor, keyed by a hash. The
  row expires at the end of the dedup window.
- With rate limiting on, one short lived row per active IP hash. The row expires
  at the end of the rate window.
- With the daily salt in use, one random salt string per UTC day, expiring after
  two days.

## What is not stored

- The raw client IP. It is used in memory to compute a hash and is then
  discarded. It is never written to storage and never logged.
- The `User-Agent` string. Only a boolean, whether it looked like a bot, appears
  in logs.
- Any cookie. No route sets one.

## How the IP hash works

When deduplication or rate limiting needs to tell visitors apart, the service
computes `SHA-256(ip + "|" + salt + "|" + window)` and keeps the first 16 bytes.
The salt rotates every UTC day unless `IP_SALT` pins it. A rotating salted hash
cannot be reversed to an IP and cannot be linked across days.

## Logs

Request logs contain the route, the status, the namespace and key, whether the
request counted, whether it looked like a bot, and the duration. They do not
contain an IP, a `User-Agent`, or a token. `Authorization` is never logged.

## Your responsibility

You are the operator of your instance. Whether a salted IP hash needs disclosure
or consent under your local law is your call to make. tallywick gives you the
tools to run it without cookies and without storing raw addresses, and the rest
is context that only you have.
