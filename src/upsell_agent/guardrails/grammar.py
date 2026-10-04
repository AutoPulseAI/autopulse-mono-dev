"""Mechanical grammar check on an AI-written draft (MASTER_PLAN_4 stream G; client, 5 Oct 2026: "the AI
was using very bad grammar").

Plain code, same answer every time, and deliberately conservative: each rule catches a mistake a careful
writer never makes, and nothing a careful writer does. It is not a style checker - wording, tone and
fragments are Compose's instructions and the grammar eval's job (evals/test_grammar.py). A failure sends the
draft back for the guard's one rewrite, then to the template, like every other guard rule.

Rules:
- a sentence (or a line) that starts with a lowercase letter;
- a doubled word ("the the"), except the few that can be doubled correctly ("that that", "had had");
- a space before , . ! ? ; and no space after a sentence's end or a comma ("today.See", "Hi,Maria");
- an SMS that doesn't end with . ! ? (or a closing quote/parenthesis after one);
- "i" on its own ("i'm", "i can");
- unbalanced parentheses or double quotation marks;
- "a" before a word that clearly starts with a vowel sound ("a apple", "a hour") and "an" before one that
  clearly doesn't ("an car", "an used"), with short known lists where the spelling misleads (a used car,
  an hour, an SUV are all right; acronyms and capitalized words are never judged).

The client's fixed wording (Touch 1's opening and closing, Touch 2's "{FirstName}?") is passed in `exempt`
and never checked: it is sent exactly as the client wrote it.
"""

import re
from collections.abc import Iterable

# Things that legitimately break the rules below: links, email addresses, abbreviations with dots.
_URL = re.compile(r"\b(?:https?://|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|us|biz|info|io|auto)\b\S*",
                  re.IGNORECASE)
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")
_ABBREVIATIONS = re.compile(
    r"\b(?:e\.g|i\.e|etc|vs|approx|est|st|ave|blvd|dr|mr|mrs|ms|jr|sr|inc|ltd|corp|dept|"
    r"jan|feb|aug|sept|oct|nov|a\.m|p\.m|u\.s|u\.s\.a)\.", re.IGNORECASE)
# Inches ('18" wheels'), list markers ("1)", "a)") and ":)" aren't quotation marks or parentheses.
_NOT_PUNCTUATION_PAIRS = re.compile(r"(?<=\d)\"|(?:^|(?<=\s))[\dA-Za-z]\)|[:;]-?[()]")

_SENTENCE_START = re.compile(r"(?:^|(?<=[.!?])\s+)([a-z][\w']*)", re.MULTILINE)
_DOUBLED = re.compile(r"\b([A-Za-z]+)\s+(\1)\b", re.IGNORECASE)
_DOUBLE_OK = {"that", "had", "is", "bye", "no", "very", "so", "really", "ha", "go", "far", "more", "knock"}
_SPACE_BEFORE = re.compile(r"[ \t]+([,.!?;])(?=\s|$)")
_NO_SPACE_AFTER_END = re.compile(r"\b[a-z]{2,}[.!?](?=[A-Z][a-z])")
_NO_SPACE_AFTER_COMMA = re.compile(r"\b[A-Za-z]{2,},(?=[A-Za-z]{2,})")
_LONE_I = re.compile(r"(?<![\w'’-])i(?:['’](?:m|ll|ve|d))?(?![\w'’-])")
_FINAL = re.compile(r"[.!?…][\"'”’)\]]*\s*$")

# "a" / "an" go by sound. Only lowercase words are judged (an SUV, a RAV4, an F-150 are read as letters or
# names), and only where the sound is clear from the spelling or a list below.
_VOWEL_SOUND = {"hour", "hours", "hourly", "honest", "honestly", "honor", "honors", "honorable", "heir"}
_CONSONANT_SOUND = {
    "one", "once", "use", "used", "user", "users", "useful", "usual", "usually", "usable", "unique", "unit",
    "units", "union", "uniform", "universal", "university", "unanimous", "utility", "utilities", "ute", "ewe",
    "euro", "european", "eulogy", "urine", "uranium", "ubiquitous", "usb", "uber", "ufo"}
_SKIP_WORDS = {"suv", "mpg", "mph", "rpm", "msrp", "vin", "awd", "fwd", "rwd", "led", "hp", "sms", "rsvp", "mri"}
_ARTICLE = re.compile(r"\b(a|an|A|An)\s+([a-z][a-z'-]*)")


def _mask(text: str) -> str:
    text = _URL.sub("LINK", text)
    text = _EMAIL.sub("EMAIL", text)
    return _ABBREVIATIONS.sub(lambda m: m.group(0).replace(".", ""), text)


def _vowel_sound(word: str) -> bool | None:
    """True / False when the sound is clear from the spelling, None when it isn't worth judging."""
    w = word.lower().split("-")[0]
    if len(w) < 2 or w in _SKIP_WORDS:
        return None
    if w in _VOWEL_SOUND:
        return True
    if w in _CONSONANT_SOUND or w.startswith("eu"):
        return False
    if w[0] in "aeio":
        return True
    if w[0] == "u":
        # an upgrade, an update, an umbrella, an unusual one; the "you"-sounding u-words are listed above.
        return True if w.startswith(("un", "up", "ug", "um", "ul", "ut")) else None
    if w[0] == "h":
        return None  # a hybrid / an historic: left alone, apart from the listed silent-h words
    return False


def _articles(text: str) -> list[str]:
    found = []
    for m in _ARTICLE.finditer(text):
        article, word = m.group(1).lower(), m.group(2)
        vowel = _vowel_sound(word)
        if vowel is True and article == "a":
            found.append(f'wrong article in "{m.group(0)}" (an {word})')
        elif vowel is False and article == "an":
            found.append(f'wrong article in "{m.group(0)}" (a {word})')
    return found


def _unbalanced(text: str) -> list[str]:
    text = _NOT_PUNCTUATION_PAIRS.sub(" ", text)
    problems = []
    if text.count("(") != text.count(")"):
        problems.append("unbalanced parentheses")
    if text.count('"') % 2 or text.count("“") != text.count("”"):
        problems.append("unbalanced quotation marks")
    return problems


def _segments(text: str, exempt: list[str]) -> list[str]:
    """The text with each exempt phrase cut out; what's left around it is checked piece by piece."""
    parts = [text]
    for phrase in sorted(set(exempt), key=len, reverse=True):
        parts = [piece for part in parts for piece in part.split(phrase)]
    return [p.strip() for p in parts if p.strip()]


def _segment_problems(seg: str) -> list[str]:
    problems = []
    for m in _SENTENCE_START.finditer(seg):
        word = m.group(1)
        before = seg[:m.start(1)].rstrip()
        if before.endswith("..") or re.match(r"[a-z]+[A-Z]", word):  # "... and then", "iPhone", "eBay"
            continue
        if word == "i" or word.startswith(("i'", "i’")):
            continue  # reported once below as "i" instead of "I"
        problems.append(f'a sentence starts with a lowercase letter ("{word}")')
    for m in _DOUBLED.finditer(seg):
        first, second = m.group(1), m.group(2)
        if first.lower() not in _DOUBLE_OK and not (first[0].isupper() and second[0].isupper()):  # Walla Walla
            problems.append(f'a doubled word ("{m.group(0)}")')
    problems += [f'a space before "{m.group(1)}"' for m in _SPACE_BEFORE.finditer(seg)]
    problems += [f'no space after "{m.group(0)}"' for m in _NO_SPACE_AFTER_END.finditer(seg)]
    problems += [f'no space after the comma in "{m.group(0)}"' for m in _NO_SPACE_AFTER_COMMA.finditer(seg)]
    if _LONE_I.search(seg):
        problems.append('"i" instead of "I"')
    return problems + _articles(seg)


def grammar_problems(text: str, *, exempt: Iterable[str] = (), needs_final_punctuation: bool = False) -> list[str]:
    """Mechanical grammar mistakes in `text`, each described for the rewrite (empty when it's clean)."""
    if not text or not text.strip():
        return []
    exempt = [p.strip() for p in exempt if p and p.strip()]
    segments = [_mask(s) for s in _segments(text, exempt)]
    problems = [p for seg in segments for p in _segment_problems(seg)]
    problems += _unbalanced("\n".join(segments))
    if needs_final_punctuation:
        tail = text.rstrip()
        if not (_FINAL.search(tail) or any(tail.endswith(p) for p in exempt)
                or _mask(tail).endswith(("LINK", "EMAIL"))):
            problems.append("the message doesn't end with a period, question mark or exclamation point")
    return list(dict.fromkeys(problems))


def check_draft_grammar(draft: dict | None, *, exempt: Iterable[str] = ()) -> list[str]:
    """The guard's grammar rule, on the SMS and the email body (the subject is a heading, not a sentence)."""
    if not draft:
        return []
    exempt = list(exempt)
    violations = []
    for name, key, final in (("SMS", "sms_text", True), ("email", "email_body", False)):
        problems = grammar_problems(str(draft.get(key) or ""), exempt=exempt, needs_final_punctuation=final)
        if problems:
            violations.append(f"grammar in the {name}: " + "; ".join(problems))
    return violations
