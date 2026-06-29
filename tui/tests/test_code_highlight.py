"""T-025: pygments syntax highlighting for code blocks.

Pure renderer tests — assert that a code block with a real language produces
styled token spans, and that `text`/unknown languages stay unstyled.
"""

from __future__ import annotations

from rich.panel import Panel
from rich.text import Text

from bartleby_tui.renderer import Block, Inline, render_document


def _code_panel_text(language: str, code: str) -> Text:
    block = Block(kind="code_block", inlines=[Inline(text=code)], attrs={"language": language})
    group = render_document([block])
    panel = group.renderables[0]
    assert isinstance(panel, Panel)
    assert isinstance(panel.renderable, Text)
    return panel.renderable


def _spans_by_text(text: Text) -> list[tuple[str, str]]:
    return [(text.plain[s.start : s.end], str(s.style)) for s in text.spans]


def test_python_keyword_and_comment_have_token_styles() -> None:
    text = _code_panel_text("py", "def foo():\n    return 1  # note")
    spans = _spans_by_text(text)
    assert any(frag == "def" and "magenta" in style for frag, style in spans)
    assert any(frag == "1" and "cyan" in style for frag, style in spans)
    assert any(frag == "# note" and "dim" in style for frag, style in spans)


def test_string_literal_is_styled() -> None:
    text = _code_panel_text("py", "x = 'hi'")
    spans = _spans_by_text(text)
    assert any("hi" in frag and "green" in style for frag, style in spans)


def test_plain_text_language_is_unstyled() -> None:
    text = _code_panel_text("text", "def not_code()")
    # No language → no token styling at all.
    assert text.spans == []


def test_unknown_language_falls_back_to_plain() -> None:
    text = _code_panel_text("not-a-real-language", "def foo()")
    assert text.plain == "def foo()"
    assert text.spans == []
