# TrackByPhoto — AI Photo Memo Prompt

Turns a photo into one short, warm sentence about what the senior is *doing* — not a list of everything in the picture. Output language is controlled by a variable so the same prompt works for Korean, Japanese, English, etc.

---

## How the language variable works

- Replace `{{OUTPUT_LANGUAGE}}` with the recipient family's language (e.g., `Korean`, `Japanese`, `English`).
- Set it **per family** from your app settings, so each family reads the update in their own language. Default: `Korean`.
- The `activity` field stays in **fixed English categories** (below) no matter the language — that keeps your app logic, icons, and colors consistent. Only the `memo` sentence gets translated.

**Activity categories (fixed English keys):**
`Meal` · `Walk` · `Rest` · `Family time` · `Outing` · `Hobby` · `Nature` · `Other`

> Tip: the app knows the clock, so let it turn `Meal` into "breakfast / lunch / dinner" itself — the AI shouldn't guess the time of day.

---

## The prompt (paste into Gemini `systemInstruction`)

```
You are a helper that warmly shares a senior's day with their family.
Look at the photo and write, in one short and kind sentence, what the senior is doing.

Rules:
1. One sentence, 12 words or fewer. Focus on the activity (what they are doing).
2. Never list objects, clothing, colors, background, or counts of things.
3. Write it warmly, like a caption a family member would smile at.
4. If unsure, stay general and truthful — do not invent specific facts.
5. Do not guess people's names, text shown in the photo, or any health/medication/diagnosis.
6. If the photo is blurry or the activity is unclear,
   set "memo" to a phrase meaning "Captured a moment today." and "activity" to "Other".

Write the "memo" in {{OUTPUT_LANGUAGE}}.
Keep "activity" as exactly ONE of these English categories:
Meal, Walk, Rest, Family time, Outing, Hobby, Nature, Other.

Reply ONLY in this JSON format:
{"activity":"<one category from the list>", "memo":"<short, warm sentence in {{OUTPUT_LANGUAGE}}>"}

Examples (shown in English — translate the memo into {{OUTPUT_LANGUAGE}}):
- Food and utensils on a table → {"activity":"Meal","memo":"Enjoying a nice meal."}
- Park path with trees → {"activity":"Walk","memo":"Taking a walk in the park."}
- Sofa and television → {"activity":"Rest","memo":"Relaxing in the living room."}
- People gathered and smiling → {"activity":"Family time","memo":"Spending happy time with family."}
- A potted flower → {"activity":"Nature","memo":"Admiring the pretty flowers."}
- A blurry or unclear photo → {"activity":"Other","memo":"Captured a moment today."}
```

---

## Same photo, three languages (what the variable does)

| `{{OUTPUT_LANGUAGE}}` | Resulting `memo` |
|---|---|
| Korean | 맛있게 식사하고 계세요. |
| Japanese | おいしくお食事中です。 |
| English | Enjoying a nice meal. |

---

## Gemini settings

- `temperature: 0.5` — a little warmth, still consistent
- `maxOutputTokens: 80` — hard stop so it can't run long
- `responseMimeType: "application/json"` — forces clean JSON
- Optional `responseSchema` to lock the shape:

```json
{
  "type": "object",
  "properties": {
    "activity": {
      "type": "string",
      "enum": ["Meal","Walk","Rest","Family time","Outing","Hobby","Nature","Other"]
    },
    "memo": { "type": "string" }
  },
  "required": ["activity","memo"]
}
```

---

## Drop-in snippet (Firebase Cloud Function, Node)

```js
function buildSystemInstruction(outputLanguage = "Korean") {
  return SYSTEM_PROMPT.replaceAll("{{OUTPUT_LANGUAGE}}", outputLanguage);
}

// outputLanguage comes from each family's settings (default "Korean")
const result = await model.generateContent({
  systemInstruction: buildSystemInstruction(family.outputLanguage),
  contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64Photo } }] }],
  generationConfig: {
    temperature: 0.5,
    maxOutputTokens: 80,
    responseMimeType: "application/json",
    responseSchema: MEMO_SCHEMA
  }
});

const { activity, memo } = JSON.parse(result.response.text());
// time + place come from the phone (clock + GPS), NOT from the AI
```

---

## Safety reminders (important for an elder-care product)

- **Truthful-but-general beats specific-but-wrong.** A vague safe line never alarms family; a wrong specific ("taking medication") can.
- **No medical, name, or text reading.** Rule 5 blocks the riskiest mistakes.
- **Always pass time + location from the phone**, not the AI — cheaper, shorter, and no hallucinated places.
