// Contrato del dataset privado de establecimientos.
// Era contracts/gate-1.1-experiment-dataset.schema.json; ahora vive junto a su
// validador (app/contract.mjs), que es quien lo interpreta de verdad.

export const DATASET_SCHEMA = Object.freeze({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:facilito-ux-lab:gate-1.1:experiment-dataset:1.1.0",
  "title": "Dataset privado del experimento J1 en Lima provincia",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "dataset_id",
    "scope",
    "temporal_context",
    "offers"
  ],
  "properties": {
    "schema_version": {
      "const": "1.1.0"
    },
    "dataset_id": {
      "type": "string",
      "pattern": "^gate-1\\.1-lima-province-gasohol-regular-[0-9]{4}-[0-9]{2}-[0-9]{2}$"
    },
    "scope": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "journey",
        "department",
        "province",
        "population",
        "origin_policy",
        "product",
        "display_unit",
        "usage"
      ],
      "properties": {
        "journey": {
          "const": "J1"
        },
        "department": {
          "const": "LIMA"
        },
        "province": {
          "const": "LIMA"
        },
        "population": {
          "const": "todas las ofertas frescas de Lima provincia; sin límite distrital"
        },
        "origin_policy": {
          "const": "ubicación actual real o simulada; idéntica en A y B"
        },
        "product": {
          "const": "Gasohol Regular"
        },
        "display_unit": {
          "const": "S/ por galón"
        },
        "usage": {
          "const": "experimento privado; no publicar"
        }
      }
    },
    "temporal_context": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "snapshot_date",
        "source_max_reported_at",
        "cutoff_at",
        "acquisition_started_at",
        "acquisition_completed_at",
        "source_last_modified_at"
      ],
      "properties": {
        "snapshot_date": {
          "type": "string",
          "format": "date"
        },
        "source_max_reported_at": {
          "type": "string",
          "format": "date-time"
        },
        "cutoff_at": {
          "type": "string",
          "format": "date-time"
        },
        "acquisition_started_at": {
          "type": "string",
          "format": "date-time"
        },
        "acquisition_completed_at": {
          "type": "string",
          "format": "date-time"
        },
        "source_last_modified_at": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "offers": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/offer"
      }
    }
  },
  "$defs": {
    "offer": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "experimental_id",
        "establishment_id",
        "source_row_id",
        "product",
        "currency",
        "unit",
        "display_unit",
        "price",
        "price_reported_at",
        "age_days_at_cutoff",
        "territory",
        "coordinate",
        "provisional_identity",
        "source",
        "warnings"
      ],
      "properties": {
        "experimental_id": {
          "type": "string",
          "pattern": "^offer_[a-f0-9]{24}$"
        },
        "establishment_id": {
          "type": "string",
          "pattern": "^est_[a-f0-9]{24}$"
        },
        "source_row_id": {
          "type": "string",
          "pattern": "^row_[a-f0-9]{24}$"
        },
        "product": {
          "const": "Gasohol Regular"
        },
        "currency": {
          "const": "PEN"
        },
        "unit": {
          "const": "galón"
        },
        "display_unit": {
          "const": "S/ por galón"
        },
        "price": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "price_reported_at": {
          "type": "string",
          "format": "date-time"
        },
        "age_days_at_cutoff": {
          "type": "number",
          "minimum": 0,
          "maximum": 30
        },
        "territory": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "department",
            "province",
            "district"
          ],
          "properties": {
            "department": {
              "const": "LIMA"
            },
            "province": {
              "const": "LIMA"
            },
            "district": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "coordinate": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "longitude",
            "latitude",
            "classification"
          ],
          "properties": {
            "longitude": {
              "type": "number",
              "minimum": -82,
              "maximum": -68
            },
            "latitude": {
              "type": "number",
              "minimum": -19,
              "maximum": 1
            },
            "classification": {
              "const": "coordenada oficial exacta; reutilización pública no autorizada"
            }
          }
        },
        "provisional_identity": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "label",
            "legal_name",
            "address"
          ],
          "properties": {
            "label": {
              "const": "IDENTIDAD PROVISIONAL — razón social/dirección"
            },
            "legal_name": {
              "type": "string",
              "minLength": 1
            },
            "address": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "source": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "dataset_id",
            "snapshot_date",
            "acquired_at",
            "cutoff_at"
          ],
          "properties": {
            "dataset_id": {
              "const": "liquid-current"
            },
            "snapshot_date": {
              "type": "string",
              "format": "date"
            },
            "acquired_at": {
              "type": "string",
              "format": "date-time"
            },
            "cutoff_at": {
              "type": "string",
              "format": "date-time"
            }
          }
        },
        "warnings": {
          "const": [
            "IDENTIDAD PROVISIONAL: la razón social y la dirección no equivalen a nombre comercial.",
            "El precio reportado no demuestra stock.",
            "Uso exclusivo del experimento privado; no publicar."
          ]
        }
      }
    }
  }
});
