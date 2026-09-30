def test_health_returns_200(make_client):
    response = make_client().get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
