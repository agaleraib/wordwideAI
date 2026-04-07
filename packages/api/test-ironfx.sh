#!/usr/bin/env bash
# IronFX E2E translation test — creates profile + runs translation pipeline
set -euo pipefail

API="${FINFLOW_API:-http://localhost:3002}"

echo "=== 1. Creating IronFX profile (es-ES) ==="
curl -s -X POST "$API/profiles" \
  -H "Content-Type: application/json" \
  -d '{
  "clientId": "ironfx",
  "clientName": "IronFX",
  "sourceLanguage": "en",
  "languages": {
    "es": {
      "regionalVariant": "es-ES",
      "glossary": {
        "support level": "nivel de soporte",
        "resistance level": "nivel de resistencia",
        "trading": "trading",
        "forex": "forex",
        "FX Strategy": "estrategia de FX",
        "market analysis": "análisis de mercado",
        "technical analysis": "análisis técnico",
        "fundamental analysis": "análisis fundamental",
        "commodities": "materias primas",
        "foreign exchange": "mercado de divisas",
        "traders": "traders",
        "investing opportunities": "oportunidades de inversión",
        "market direction": "dirección del mercado",
        "trading decisions": "decisiones de trading",
        "viewpoint": "punto de vista",
        "broadcast": "emisión",
        "rebroadcasting": "reemisión"
      },
      "forbiddenTerms": [],
      "tone": {
        "formalityLevel": 4,
        "description": "professional, institutional, financial broadcast tone",
        "passiveVoiceTargetPct": 20,
        "avgSentenceLength": 24,
        "sentenceLengthStddev": 7,
        "personPreference": "third",
        "hedgingFrequency": "moderate"
      },
      "brandRules": [
        "Always write IronFX as a single word with capital I and F",
        "Always write CCTV in uppercase",
        "Keep program name IronFX Viewpoint untranslated",
        "Keep proper names (Marshall Gittler, Antypas Asfour) untranslated"
      ],
      "compliancePatterns": [],
      "scoring": {
        "metricThresholds": {
          "glossary_compliance": 95,
          "term_consistency": 90,
          "untranslated_terms": 95,
          "formality_level": 85,
          "sentence_length_ratio": 80,
          "passive_voice_ratio": 80,
          "brand_voice_adherence": 95,
          "formatting_preservation": 90,
          "numerical_accuracy": 100,
          "paragraph_alignment": 85,
          "fluency": 85,
          "meaning_preservation": 90,
          "regional_variant": 90
        },
        "aggregateThreshold": 88,
        "metricWeights": {},
        "maxRevisionAttempts": 2
      }
    }
  }
}' | jq .

echo ""
echo "=== 2. Verifying profile ==="
curl -s "$API/profiles/ironfx" | jq '.clientId, .clientName, (.languages | keys)'

echo ""
echo "=== 3. Running translation pipeline ==="
curl -s -X POST "$API/translate" \
  -H "Content-Type: application/json" \
  -d '{
  "sourceText": "IronFX Viewpoint by Marshall Gittler, Head of Global FX Strategy, and Antypas Asfour, FX Strategist on CCTV Finance Channel in China. IronFX is featured on CCTV Finance in China with the exclusive program called IronFX View Point, presented by Marshall Gittler, Head of Global FX Strategy and Antypas Asfour, FX Strategist at IronFX.\n\nChina Central Television, commonly abbreviated as CCTV, is the predominant state television broadcaster in mainland China. CCTV has a network of 22 channels broadcasting different programs and is accessible to more than one billion viewers. CCTV Finance is the finance focused channel of CCTV in China.\n\nIronFX Viewpoint provides clients with technical and fundamental market analyses that assist in identifying potentially profitable trading and investing opportunities. Our Strategy Team expresses its views on the foreign exchange market, commodities, and economies, analyzing how these are likely to move in the future. By examining trends, trying to anticipate market direction, our Strategists act as an additional resource for traders in their trading decisions.\n\nThe schedule for the broadcast is as follows:\nBroadcasting: 8:30-9:30 am (GMT +8) every Tuesday and Thursday.\nRebroadcasting: 6:00-7:00 am (GMT +8) every Wednesday and Friday",
  "clientId": "ironfx",
  "language": "es"
}' | jq .
