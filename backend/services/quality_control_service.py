import re
from difflib import SequenceMatcher


IMPORTANT_TYPES = {
    "heading",
    "title",
    "subtitle",
    "summary",
    "abstract"
}

LOW_VALUE_KEYWORDS = {
    "login",
    "sign in",
    "sign up",
    "register",
    "menu",
    "share",
    "cookie",
    "privacy",
    "terms",
    "subscribe",
    "newsletter",
    "advertisement",
    "read more",
    "back to top"
}


def normalize_text(text: str) -> str:
    if not text:
        return ""

    text = text.lower()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"[^\wğüşıöçİĞÜŞÖÇ\s]", "", text)
    return text.strip()


def is_important_short_block(block: dict) -> bool:
    text = block.get("text", "").strip()
    block_type = block.get("type", "").lower()

    if block_type in IMPORTANT_TYPES and len(text) >= 2:
        return True

    if len(text.split()) <= 8 and text.endswith(":"):
        return True

    return False


def is_low_quality_block(block: dict) -> bool:
    text = block.get("text", "").strip()
    normalized = normalize_text(text)

    if not normalized:
        return True

    if is_important_short_block(block):
        return False

    word_count = len(normalized.split())

    if word_count < 5:
        return True

    if normalized in LOW_VALUE_KEYWORDS:
        return True

    for keyword in LOW_VALUE_KEYWORDS:
        if normalized == keyword or normalized.startswith(keyword):
            return True

    unique_words = set(normalized.split())
    if word_count > 0 and len(unique_words) / word_count < 0.35:
        return True

    return False


def similarity_ratio(text1: str, text2: str) -> float:
    return SequenceMatcher(None, text1, text2).ratio()


def deduplicate_blocks(blocks: list, similarity_threshold: float = 0.92):
    kept_blocks = []
    removed_duplicates = 0

    seen_exact = set()

    for block in blocks:
        text = block.get("text", "")
        normalized = normalize_text(text)

        if not normalized:
            continue

        if normalized in seen_exact:
            removed_duplicates += 1
            continue

        is_similar = False

        for kept in kept_blocks:
            kept_normalized = normalize_text(kept.get("text", ""))

            if similarity_ratio(normalized, kept_normalized) >= similarity_threshold:
                is_similar = True
                break

        if is_similar:
            removed_duplicates += 1
            continue

        seen_exact.add(normalized)
        kept_blocks.append(block)

    return kept_blocks, removed_duplicates


def apply_quality_control(blocks: list) -> dict:
    total_blocks = len(blocks)

    filtered_blocks = []
    removed_low_quality = 0

    for block in blocks:
        if is_low_quality_block(block):
            removed_low_quality += 1
        else:
            filtered_blocks.append(block)

    deduplicated_blocks, removed_duplicates = deduplicate_blocks(filtered_blocks)

    return {
        "blocks": deduplicated_blocks,
        "stats": {
            "total_blocks": total_blocks,
            "removed_low_quality": removed_low_quality,
            "removed_duplicates": removed_duplicates,
            "kept_blocks": len(deduplicated_blocks)
        }
    }