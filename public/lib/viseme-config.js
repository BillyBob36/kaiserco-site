// viseme-config.js
export const VISEME_DEFAULTS = {
    "viseme_sil": [],
    "viseme_PP": [
        {
            "shape": "V_Tight",
            "intensity": 1.15
        }
    ],
    "viseme_FF": [
        {
            "shape": "V_Lip_Open",
            "intensity": 1.3
        }
    ],
    "viseme_TH": [
        {
            "shape": "V_Dental_Lip",
            "intensity": 1.25
        }
    ],
    "viseme_DD": [
        {
            "shape": "V_Tight_O",
            "intensity": 1.05
        },
        {
            "shape": "V_Open",
            "intensity": 0
        }
    ],
    "viseme_kk": [
        {
            "shape": "V_Lip_Open",
            "intensity": 0.6
        },
        {
            "shape": "V_Tight_O",
            "intensity": 0.3
        }
    ],
    "viseme_CH": [
        {
            "shape": "V_Affricate",
            "intensity": 1
        }
    ],
    "viseme_SS": [
        {
            "shape": "V_Lip_Open",
            "intensity": 1.2
        }
    ],
    "viseme_nn": [
        {
            "shape": "V_Tight_O",
            "intensity": 0.9
        }
    ],
    "viseme_RR": [
        {
            "shape": "V_Lip_Open",
            "intensity": 1
        }
    ],
    "viseme_aa": [
        {
            "shape": "V_Open",
            "intensity": 0.3
        }
    ],
    "viseme_E": [
        {
            "shape": "V_Lip_Open",
            "intensity": 0.95
        }
    ],
    "viseme_I": [
        {
            "shape": "V_Wide",
            "intensity": 1.85
        },
        {
            "shape": "V_Lip_Open",
            "intensity": 0.75
        }
    ],
    "viseme_O": [
        {
            "shape": "V_Tight_O",
            "intensity": 0.75
        },
        {
            "shape": "V_Open",
            "intensity": 0.35
        }
    ],
    "viseme_U": [
        {
            "shape": "V_Tight",
            "intensity": 1
        }
    ]
};

export const ALL_SHAPE_KEYS = ["V_Open","V_Tight","V_Affricate","V_Tight_O","V_Wide","V_Lip_Open","V_Dental_Lip","V_Explosive","V_Tongue_Raise","V_Tongue_Out","V_Tongue_Lower","V_Tongue_Curl-U","V_Tongue_Curl-D"];

export const VISEME_LABELS = {
    "viseme_sil": "Silence",
    "viseme_PP": "PP / BB / MM",
    "viseme_FF": "FF / VV",
    "viseme_TH": "TH (the)",
    "viseme_DD": "DD / TT / NN",
    "viseme_kk": "KK / GG",
    "viseme_CH": "CH / JJ / SH",
    "viseme_SS": "SS / ZZ",
    "viseme_nn": "NN (nasal)",
    "viseme_RR": "RR / LL",
    "viseme_aa": "AA (papa)",
    "viseme_E": "E (the)",
    "viseme_I": "I (si)",
    "viseme_O": "O (mot)",
    "viseme_U": "U (ou)"
};