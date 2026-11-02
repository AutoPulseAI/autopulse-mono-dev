"""The customer's language (PLAN_4 stream Q). Seen in the stream E run: a Spanish-speaking customer ("Hola,
¿hablan español?") got one English template and then nothing. Nothing in the CRM translates messages, but the
Compose model writes Spanish well, so a customer who writes in Spanish is answered in Spanish (Decide sets
`reply_language`), and the staff see the language on the lead.

Plain code, no AI: a message counts as Spanish when it has at least two common Spanish words, or one plus a
Spanish-only character (¿ ¡ ñ or an accented vowel). A short reply with no words to go on ("11", "ok") keeps
the language of the customer's earlier messages. English is the default.
"""

import re
from collections.abc import Iterable

SPANISH = "Spanish"

_SPANISH_WORDS = frozenset(re.findall(r"\S+", """
hola gracias quiero tengo tiene tienen puedo puede pueden cuanto cuánto cuánta cuanta como cómo donde dónde
cuando cuándo que qué carro coche camioneta usted ustedes hablan habla español espanol millas debo todavía
todavia también tambien mañana manana sábado sabado domingo lunes martes miércoles miercoles jueves viernes
buenas buenos dias días tardes noches por favor necesito busco estoy está esta están estan mi mis su sus muy
bien sí si nada vender comprar precio pago dinero quisiera favor ayuda un una uno unos el la los las del para con pero
"""))
_ENGLISH_WORDS = frozenset(re.findall(r"\S+", """
the and you your have has want need what when where how much is are can could would will my it this that with
for of to do does please thanks thank yes no just about there car truck price
"""))
_SPANISH_CHARS = re.compile(r"[¿¡ñáéíóú]", re.IGNORECASE)
_WORD = re.compile(r"[a-záéíóúñü]+", re.IGNORECASE)


def _score(text: str) -> tuple[int, int]:
    words = [w.lower() for w in _WORD.findall(text or "")]
    spanish = sum(w in _SPANISH_WORDS for w in words) + (1 if _SPANISH_CHARS.search(text or "") else 0)
    english = sum(w in _ENGLISH_WORDS for w in words)
    return spanish, english


def message_language(text: str) -> str | None:
    """SPANISH, "English", or None when the message is too short to tell."""
    spanish, english = _score(text)
    if spanish >= 2 and spanish > english:
        return SPANISH
    if english >= 1 and english >= spanish:
        return "English"
    return None


def customer_language(latest: str, earlier: Iterable[str] = ()) -> str | None:
    """The language to reply in when it isn't English (SPANISH), else None. The latest message decides; when it
    can't (a time, "ok"), the most recent earlier message that can."""
    for text in [latest, *reversed(list(earlier))]:
        found = message_language(text)
        if found:
            return found if found != "English" else None
    return None


# Spanish day and time words, put into the English the dealership's date and booking code reads
# (slots/dates.py, tools/booking_tool.py). Only for a customer writing in Spanish: "¿Puedo ir el sábado en la
# mañana?" -> "... Saturday morning", "A las 11" -> "at 11". "mañana" alone is tomorrow; "en/por la mañana" is
# the morning.
_ES_DATE_WORDS = [
    (r"\b(?:en|por) la mañana\b", "morning"), (r"\b(?:en|por) la tarde\b", "afternoon"),
    (r"\b(?:en|por) la noche\b", "evening"), (r"\bpasado mañana\b", "the day after tomorrow"),
    (r"\bmañana\b", "tomorrow"), (r"\bhoy\b", "today"), (r"\besta semana\b", "this week"),
    (r"\bla próxima semana\b|\bla semana que viene\b", "next week"),
    (r"\blunes\b", "Monday"), (r"\bmartes\b", "Tuesday"), (r"\bmi[ée]rcoles\b", "Wednesday"),
    (r"\bjueves\b", "Thursday"), (r"\bviernes\b", "Friday"), (r"\bs[áa]bado\b", "Saturday"),
    (r"\bdomingo\b", "Sunday"), (r"\b(?:a las|a la)\s+(\d{1,2}(?::\d{2})?)\b", r"at \1"),
    (r"\bmismo horario\b|\bmisma hora\b", "same time"),
]


# Junling Fan, 2 Nov 2026: "明天去看上午" (tomorrow morning), "9点左右" (around 9), "10点" (10 o'clock) were never
# read, so the visit she confirmed was never booked. Chinese has no spaces, so these words are put into English
# with spaces around them ("明天上午10点" -> "tomorrow morning at 10").
_ZH_DIGITS = {"一": "1", "二": "2", "两": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8",
              "九": "9", "十": "10", "十一": "11", "十二": "12"}
_ZH_DAYS = {"一": "Monday", "二": "Tuesday", "三": "Wednesday", "四": "Thursday", "五": "Friday", "六": "Saturday",
            "日": "Sunday", "天": "Sunday"}
_ZH_HOUR = r"(\d{1,2}|十[一二]?|[一二两三四五六七八九])"
_ZH_DATE_WORDS = [
    (_ZH_HOUR + r"\s*[点點]\s*半", lambda m: f" at {_ZH_DIGITS.get(m[1], m[1])}:30 "),
    (_ZH_HOUR + r"\s*[点點](?:\s*(\d{1,2})\s*分)?",
     lambda m: f" at {_ZH_DIGITS.get(m[1], m[1])}" + (f":{int(m[2]):02d}" if m[2] else "") + " "),
    (r"后天|後天", " the day after tomorrow "), (r"明天|明日", " tomorrow "), (r"今天|今日", " today "),
    (r"上午|早上|早晨", " morning "), (r"中午", " noon "), (r"下午", " afternoon "), (r"晚上|傍晚", " evening "),
    (r"左右", " or so "), (r"下周|下星期|下礼拜", " next week "), (r"这周|本周|这星期", " this week "),
    (r"(?:星期|周|週|礼拜)([一二三四五六日天])", lambda m: f" {_ZH_DAYS[m[1]]} "),
]
_ZH = re.compile(r"[一-鿿]")


def chinese_dates_to_english(text: str) -> str:
    """Chinese day and time words in English, for the booking code; a message without Chinese is unchanged."""
    out = text or ""
    if not _ZH.search(out):
        return out
    for pattern, english in _ZH_DATE_WORDS:
        out = re.sub(pattern, english, out)
    return re.sub(r"\s+", " ", out).strip()


def dates_to_english(text: str) -> str:
    """A Spanish (or Chinese) message with its day and time words in English, for the booking code; other words
    unchanged."""
    out = text or ""
    for pattern, english in _ES_DATE_WORDS:
        out = re.sub(pattern, english, out, flags=re.IGNORECASE)
    return chinese_dates_to_english(out)
