# IronFX ES Glossary — Flagged Terms for Review

Generated from benchmark analysis on AM050115 and AM050415.
These terms are causing false glossary compliance failures because
the AI produces better or equally valid translations.

## sideways
- **Current glossary:** "marginal"
- **Issue:** MISTRANSLATION
- **Detail:** "Marginal" means peripheral/minor in Spanish, not "sideways". The correct financial term is "lateral" (movimiento lateral, rango lateral). AI correctly uses "lateral".
- **Suggestion:** lateral

## haircut
- **Current glossary:** "devaluación"
- **Issue:** WRONG CONCEPT
- **Detail:** "Devaluación" means "devaluation" (currency losing value). A financial "haircut" (reduction in collateral value) is "recorte" or "quita" in Spanish. These are different financial concepts.
- **Suggestion:** recorte

## policy meeting
- **Current glossary:** "reunión de políticas"
- **Issue:** LESS PRECISE
- **Detail:** "Reunión de políticas" (policies meeting) is vague. The AI writes "reunión de política monetaria" (monetary policy meeting) which is more accurate in the central bank context.
- **Suggestion:** reunión de política monetaria

## psychological round number
- **Current glossary:** "cifra psicológicamente redonda"
- **Issue:** UNNECESSARILY VERBOSE
- **Detail:** "Cifra psicológicamente redonda" is awkward and rarely used. Standard financial Spanish uses "número redondo psicológico" or simply "cifra redonda". The adverb form is unnatural.
- **Suggestion:** número redondo psicológico

## break above
- **Current glossary:** "irrupción por encima de"
- **Issue:** VALID BUT UNCOMMON
- **Detail:** "Irrupción" (irruption/burst) is dramatic and less standard than "ruptura" (break). Both are valid but "ruptura por encima de" is more commonly used in Spanish financial analysis.
- **Suggestion:** ruptura por encima de

## break below
- **Current glossary:** "irrupción por debajo de"
- **Issue:** VALID BUT UNCOMMON
- **Detail:** Same as "break above" — "ruptura por debajo de" is more standard.
- **Suggestion:** ruptura por debajo de

## 4-hour chart
- **Current glossary:** "gráfico de cuatro horas"
- **Issue:** COSMETIC
- **Detail:** Identical meaning. "Gráfico de 4 horas" (digit) vs "gráfico de cuatro horas" (word). Both correct. The digit form is more common in financial contexts.
- **Suggestion:** gráfico de 4 horas

## pull the trigger
- **Current glossary:** "volver a la carga"
- **Issue:** IDIOMATIC PREFERENCE
- **Detail:** Both are valid idioms for decisive action. "Volver a la carga" (return to the charge) is one option. AI may use "apretar el gatillo" (pull the trigger, literal) or other valid idioms. Hard to enforce deterministically.
- **Suggestion:** Keep as-is but lower enforcement priority

## crowded trade
- **Current glossary:** "mercado abarrotado"
- **Issue:** QUESTIONABLE
- **Detail:** "Mercado abarrotado" (crowded market) is a literal translation. In financial Spanish, "posición masificada" or "operación saturada" may be more technical. Needs native financial translator review.
- **Suggestion:** Needs expert review

## collapsed
- **Current glossary:** "se colapsó"
- **Issue:** TOO SPECIFIC
- **Detail:** The glossary mandates one conjugation ("se colapsó" — past tense, reflexive). The AI may correctly use "se colapsa" (present), "colapsó" (non-reflexive), or "se desplomó" (synonym). Single conjugation form cannot be enforced across tenses.
- **Suggestion:** Remove — verb forms cannot be glossary-enforced

---

## Impact Summary

- 2 MISTRANSLATIONS (sideways, haircut) — glossary is wrong
- 1 LESS PRECISE (policy meeting) — AI version is better
- 1 VERBOSE (psychological round number) — unnatural phrasing
- 2 UNCOMMON (break above/below) — valid but not standard
- 1 COSMETIC (4-hour chart) — digit vs word, identical meaning
- 1 IDIOMATIC (pull the trigger) — subjective preference
- 1 QUESTIONABLE (crowded trade) — needs expert review
- 1 TOO SPECIFIC (collapsed) — verb conjugation cannot be enforced

If these 10 terms are fixed/removed, glossary compliance would
jump from ~82% to ~95%+ without any patcher or fluency loss.
