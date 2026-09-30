from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """Liveness check: returns 200 while the service is up. Used by monitors and deploys."""
    return {"status": "ok"}
