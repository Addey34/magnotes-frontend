// Kept apart so modules that only need the API base URL stay free of Vite's
// `import.meta` in their own code and remain unit-testable (mock this file).
export const baseUrl: string = import.meta.env.VITE_API_URL || '';
