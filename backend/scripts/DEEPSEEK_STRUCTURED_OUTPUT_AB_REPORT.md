# DeepSeek Structured Output A/B Report

Fill this template from explicitly saved local Probe responses. Do not commit API
keys, Authorization headers, `.env` contents, or unredacted provider logs.

## Runs compared

- JSON run: `MODEL=` / `CASE=` / local response file:
- Strict run: `MODEL=` / `CASE=` / local response file:
- Date/time and environment (no secrets):

## Per-round quality review

| Case | Round | Question | JSON Answer | Strict Answer | JSON Structure | Strict Structure | Quality Better |
|---|---:|---|---|---|---|---|---|
| | 1 | | | | | | JSON / STRICT / EQUAL / BOTH_BAD |
| | 2 | | | | | | JSON / STRICT / EQUAL / BOTH_BAD |
| | 3 | | | | | | JSON / STRICT / EQUAL / BOTH_BAD |
| | 4 | | | | | | JSON / STRICT / EQUAL / BOTH_BAD |
| | 5 | | | | | | JSON / STRICT / EQUAL / BOTH_BAD |
| | 6 | | | | | | JSON / STRICT / EQUAL / BOTH_BAD |
| | 7 | | | | | | JSON / STRICT / EQUAL / BOTH_BAD |
| | 8 | | | | | | JSON / STRICT / EQUAL / BOTH_BAD |
| | 9 | | | | | | JSON / STRICT / EQUAL / BOTH_BAD |
| | 10 | | | | | | JSON / STRICT / EQUAL / BOTH_BAD |

Repeat this table for the second case.

## Human scoring notes

For each mode, record evidence and examples for:

1. Whether it accurately answers the current question.
2. Whether it is natural.
3. Whether it remains child-friendly.
4. Whether it correctly carries the conversation history.
5. Whether it over-corrects back to felt craft.
6. Whether it sounds obviously templated.
7. Whether it produced a meaningless fallback.
8. Whether redirect/reject safety behavior is appropriate.

## Machine metrics

Paste the Probe summaries here. Compare structure success rate, empty/whitespace
count, invalid-structure count, latency percentiles, safety actions, and failure
reasons before making a product decision.
