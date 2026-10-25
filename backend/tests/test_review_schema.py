"""Review validation rules (T058).

T058 acceptance: when a review is empty or longer than the limit, it is rejected with a clear
message.
"""

import pytest
from pydantic import ValidationError

from app.schemas import ReviewCreate
from app.schemas.review import BODY_MAX_LENGTH, TITLE_MAX_LENGTH, author_name


def error_message(**fields) -> str:
    with pytest.raises(ValidationError) as caught:
        ReviewCreate(**fields)
    (error,) = caught.value.errors()
    return error["msg"]


def test_valid_review_is_accepted() -> None:
    review = ReviewCreate(title="Great for road trips", body="Crunchy and not too salty.")

    assert review.title == "Great for road trips"
    assert review.body == "Crunchy and not too salty."


@pytest.mark.parametrize("body", ["", "   ", "\n\n\t "])
def test_empty_review_is_rejected_with_a_clear_message(body) -> None:
    assert "The review can't be empty" in error_message(body=body)


def test_review_longer_than_the_limit_is_rejected_with_a_clear_message() -> None:
    message = error_message(body="a" * (BODY_MAX_LENGTH + 1))

    assert f"The review is {BODY_MAX_LENGTH + 1} characters" in message
    assert f"keep it to {BODY_MAX_LENGTH} or fewer" in message


def test_review_at_the_limit_is_accepted() -> None:
    assert len(ReviewCreate(body="a" * BODY_MAX_LENGTH).body) == BODY_MAX_LENGTH


def test_surrounding_whitespace_doesnt_count_toward_the_limit() -> None:
    review = ReviewCreate(body="  " + "a" * BODY_MAX_LENGTH + "\n\n")

    assert review.body == "a" * BODY_MAX_LENGTH


def test_runs_of_blank_lines_are_collapsed() -> None:
    review = ReviewCreate(body="Good chips.   \n\n\n\nWould buy again.")

    assert review.body == "Good chips.\n\nWould buy again."


def test_body_is_required() -> None:
    with pytest.raises(ValidationError) as caught:
        ReviewCreate()
    assert caught.value.errors()[0]["type"] == "missing"


@pytest.mark.parametrize("title", [None, "", "   "])
def test_title_is_optional_and_blank_means_none(title) -> None:
    assert ReviewCreate(title=title, body="Fine.").title is None


def test_title_longer_than_the_limit_is_rejected_with_a_clear_message() -> None:
    message = error_message(title="t" * (TITLE_MAX_LENGTH + 1), body="Fine.")

    assert f"keep it to {TITLE_MAX_LENGTH} or fewer" in message


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        ReviewCreate(body="Fine.", stars=5)


def test_non_text_body_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ReviewCreate(body=123)


@pytest.mark.parametrize(
    ("email", "shown"),
    [("alice@example.com", "a***"), ("Bob.Smith@example.com", "b***"), (None, "Shopper")],
)
def test_author_name_never_shows_the_email(email, shown) -> None:
    assert author_name(email) == shown
