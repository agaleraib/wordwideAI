#!/usr/bin/env bash
# Test profile extraction from IronFX text samples
set -euo pipefail

API="${FINFLOW_API:-http://localhost:3002}"

echo "=== Profile Extraction: IronFX (es-ES) ==="
echo "Sending 1 sample (source-only) — expect low confidence"
echo ""

curl -s -X POST "$API/profiles/extract" \
  -H "Content-Type: application/json" \
  -d '{
  "clientId": "ironfx",
  "clientName": "IronFX",
  "targetLanguage": "es",
  "regionalVariant": "es-ES",
  "samples": [
    {
      "source": "IronFX Viewpoint by Marshall Gittler, Head of Global FX Strategy, and Antypas Asfour, FX Strategist on CCTV Finance Channel in China. IronFX is featured on CCTV Finance in China with the exclusive program called IronFX View Point, presented by Marshall Gittler, Head of Global FX Strategy and Antypas Asfour, FX Strategist at IronFX.\n\nChina Central Television, commonly abbreviated as CCTV, is the predominant state television broadcaster in mainland China. CCTV has a network of 22 channels broadcasting different programs and is accessible to more than one billion viewers. CCTV Finance is the finance focused channel of CCTV in China.\n\nIronFX Viewpoint provides clients with technical and fundamental market analyses that assist in identifying potentially profitable trading and investing opportunities. Our Strategy Team expresses its views on the foreign exchange market, commodities, and economies, analyzing how these are likely to move in the future. By examining trends, trying to anticipate market direction, our Strategists act as an additional resource for traders in their trading decisions.\n\nThe schedule for the broadcast is as follows:\nBroadcasting: 8:30-9:30 am (GMT +8) every Tuesday and Thursday.\nRebroadcasting: 6:00-7:00 am (GMT +8) every Wednesday and Friday"
    }
  ],
  "autoSave": false
}' | jq '{
  clientId,
  targetLanguage,
  sampleCount,
  confidence,
  warnings,
  glossaryTermCount: (.extractedProfile.glossary | length),
  glossary: .extractedProfile.glossary,
  tone: .extractedProfile.tone,
  brandRules: .extractedProfile.brandRules,
  regionalVariant: .extractedProfile.regionalVariant
}'
