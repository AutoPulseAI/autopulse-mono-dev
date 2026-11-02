"""A yes is a yes in any language, slang or emoji (the user, 3 Nov 2026: "if someone says yes in Chinese, any language,
... if someone just says yes in a slang word, we will consider it a yes"; Junling Fan, 2 Nov 2026: "是的" to "is 10 AM
right?" was not read as a yes).

`YES` is a regex fragment the yes checks share (agent/appointment.py, agent/nodes/validate.py, agent/nodes/decide.py,
agent/human_contact.py, agent/buyers_order.py); `is_yes()` is a whole message that is only a yes.
"""

import re

YES = (r"(?:yes+|yeah+|yep+|yup+|ya+|yah|yea|ye|yas+|yess+|sure(?: thing)?|bet|for sure|fs|ok(?:ay|ey)?|oki|k+|"
       r"correct|right|exactly|absolutely|definitely|of course|sounds good|works|"
       # Spanish, Portuguese, French, Italian, German, Polish, Russian, Turkish
       r"s[ií]|claro(?: que s[ií])?|dale|vale|por supuesto|sim|oui|ja|tak|da|да|evet|certo|"
       # Hindi / Urdu, Arabic
       r"haan|han|ji|ha+n?ji|हाँ|हां|جی|ہاں|نعم|"
       # Chinese, Japanese, Korean
       r"是的?|是啊|是呀|好的?|好啊|好吧|好呀|对的?|对啊|對|可以|行|没错|沒錯|嗯+|はい|うん|네|예|"
       # emoji
       r"👍|👌|✅|✔️?|🙆)")

_ONLY_YES = re.compile(rf"^[\s\W_]*{YES}(?:[\s,.!。！~]*(?:{YES}|thanks?|thank you|please|pls|谢谢|gracias))*[\s\W_]*$",
                       re.IGNORECASE)


def is_yes(text: str | None) -> bool:
    """The whole message is a yes ("是的", "Sí", "yup", "👍", "ok bet")."""
    return bool(_ONLY_YES.match(str(text or "").strip()))
