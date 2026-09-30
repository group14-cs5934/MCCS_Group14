"""T006 acceptance: a payload missing a required product field is rejected with 422."""

import pytest

VALID_PRODUCT = {
    "barcode": "036000291452",
    "name": "Lay's Sour Cream & Onion",
    "brand_id": 1,
    "size": "184g",
}


def validate(client, payload):
    return client.post("/products/validate", json=payload)


@pytest.mark.parametrize("field", ["barcode", "name"])
def test_missing_required_field_returns_422(make_client, field):
    payload = {k: v for k, v in VALID_PRODUCT.items() if k != field}

    response = validate(make_client(), payload)

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert error["type"] == "missing"
    assert error["loc"] == ["body", field]


def test_valid_product_returns_200_and_cleaned_payload(make_client):
    response = validate(make_client(), {**VALID_PRODUCT, "name": "  Lay's Sour Cream & Onion  "})

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Lay's Sour Cream & Onion"
    assert body["barcode"] == "036000291452"
    assert body["category_id"] is None


def test_every_problem_is_reported_at_once(make_client):
    response = validate(make_client(), {"barcode": "12345", "size": "x" * 51})

    assert response.status_code == 422
    fields = {tuple(e["loc"]) for e in response.json()["detail"]}
    assert fields == {("body", "barcode"), ("body", "name"), ("body", "size")}


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": "   "},  # blank after trimming
        {"barcode": "036000291453"},  # wrong check digit
        {"image_url": "not a url"},
        {"nmae": "typo in field name"},  # unknown field
        {"brand": "Lay's"},  # brand is a reference (brand_id), not free text
    ],
)
def test_invalid_payload_returns_422(make_client, overrides):
    response = validate(make_client(), {**VALID_PRODUCT, **overrides})

    assert response.status_code == 422


def test_non_json_body_returns_422(make_client):
    response = make_client().post(
        "/products/validate", content="name=chips", headers={"Content-Type": "text/plain"}
    )

    assert response.status_code == 422
