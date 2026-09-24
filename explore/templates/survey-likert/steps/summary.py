"""Summarise each question: answers, mean, median and share who agree."""
import pandas as pd
import seqdesk_explore as sx

responses = sx.input("responses")
items = list(sx.param("items", []))
agree_from = float(sx.param("agree_from", 4))

# ---
rows = []
for item in items:
    answers = pd.to_numeric(responses[item], errors="coerce")
    outside = answers.notna() & ~answers.between(1, 5)
    if outside.any():
        sx.drop(responses[outside], f"{item}: answers outside 1 to 5")
    answers = answers.where(~outside).dropna()
    rows.append({"item": item, "answers": int(answers.size), "mean": round(float(answers.mean()), 3) if answers.size else None,
                 "median": float(answers.median()) if answers.size else None,
                 "agree_share": round(float((answers >= agree_from).mean()), 3) if answers.size else None})

# ---
sx.output("item_summary", pd.DataFrame(rows), title="Items")
sx.metric("n_respondents", int(len(responses)), label="Respondents")
sx.finish()
