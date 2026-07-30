from django.contrib import admin
from django.urls import include, path
from django.views.generic import TemplateView
from django.conf import settings
from pathlib import Path
from django.http import FileResponse, Http404


def serve_frontend(request, *args, **kwargs):
    """
    Serve the React SPA index.html for any non-API route.
    WhiteNoise handles /static/* assets; this catches everything else so
    client-side routing (React Router) works correctly.
    """
    index = settings.BASE_DIR / "frontend_dist" / "index.html"
    if index.exists():
        return FileResponse(open(index, "rb"), content_type="text/html")
    raise Http404("Frontend not built. Run `npm run build` first.")


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("api.urls")),
    # Catch-all: hand everything else to React (must be last)
    path("", serve_frontend),
    path("<path:path>", serve_frontend),
]
