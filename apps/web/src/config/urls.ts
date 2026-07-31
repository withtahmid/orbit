export const baseBackendURL = (() => {
    const mode = import.meta.env.MODE || "development";

    // Frontend should read Vite-prefixed env variables (VITE_*) at build time.
    const serverPort = import.meta.env.VITE_SERVER_PORT || "3000";
    const testBackend = import.meta.env.VITE_TEST_BACKEND_URL;
    const prodBackend = import.meta.env.VITE_BACKEND_URL;

    if (mode === "development") {
        return `${window.location.protocol}//${window.location.hostname}:${serverPort}`;
    }

    if (mode === "test") {
        return testBackend ?? "http://localhost:3001";
    }

    if (mode === "production") {
        return prodBackend ?? `${window.location.protocol}//${window.location.hostname}`;
    }

    return "invalid url";
})();
