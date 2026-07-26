# Travel Buddy: entity-extraction fix

This patch is for **ahmedmalas/Travel.Buddy.Assistant.Ai** (not Aleya Invoicing).

The cloud agent that prepared this change could **clone** Travel Buddy but received **HTTP 403** on push (`Permission denied to cursor[bot]`). Apply the patch in that repository:

```bash
git clone https://github.com/ahmedmalas/Travel.Buddy.Assistant.Ai.git
cd Travel.Buddy.Assistant.Ai
git checkout -b cursor/travel-entity-extraction-7128
git am path/to/0001-travel-entity-extraction.patch
# or: git apply path/to/0001-travel-entity-extraction.patch && git add -A && git commit
git push -u origin cursor/travel-entity-extraction-7128
```

## Behaviour

Before: travel briefs like Melbourne/Sydney/Docklands fell through to  
“I understand. Tell me a little more about what you need…”

After: Aleya extracts origin, destination, dates/times, hotel area, car hire,
stores them in conversation state, and asks only for the missing Friday date.

See `sample-reply.txt` for the verified assistant reply.
