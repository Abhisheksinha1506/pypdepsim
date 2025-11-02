/* Curated peer groups to avoid tooling noise in similarity. */

export const WEB_FRAMEWORKS: Set<string> = new Set<string>([
  "flask",
  "django",
  "fastapi",
  "tornado",
  "bottle",
  "cherrypy",
  "quart",
  "sanic",
  "falcon",
  "pyramid",
  "web2py",
]);

export const ASYNC_FRAMEWORKS: Set<string> = new Set<string>([
  "aiohttp",
  "trio",
  "curio",
  "starlette",
  "uvicorn",
]);

export const DATA_SCIENCE: Set<string> = new Set<string>([
  "pandas",
  "numpy",
  "scipy",
  "matplotlib",
  "seaborn",
  "plotly",
  "bokeh",
]);

export const ML_FRAMEWORKS: Set<string> = new Set<string>([
  "tensorflow",
  "torch",
  "pytorch",
  "scikit-learn",
  "keras",
  "xgboost",
  "lightgbm",
]);

export const TESTING_FRAMEWORKS: Set<string> = new Set<string>([
  "pytest",
  "unittest",
  "nose",
  "tox",
  "hypothesis",
  "mock",
]);

export const ORMS: Set<string> = new Set<string>([
  "sqlalchemy",
  "peewee",
  "pony",
  "tortoise-orm",
  "django-orm",
]);

// Combined UI frameworks for similarity computation
export const UI_FRAMEWORKS: Set<string> = new Set<string>([
  ...WEB_FRAMEWORKS,
  ...ASYNC_FRAMEWORKS,
]);

export function isUiFramework(name: string): boolean {
  const lower = name.toLowerCase();
  return UI_FRAMEWORKS.has(lower) || WEB_FRAMEWORKS.has(lower) || ASYNC_FRAMEWORKS.has(lower);
}

export function isWebFramework(name: string): boolean {
  return WEB_FRAMEWORKS.has(name.toLowerCase());
}

export function isDataScience(name: string): boolean {
  return DATA_SCIENCE.has(name.toLowerCase());
}

export function isMLFramework(name: string): boolean {
  return ML_FRAMEWORKS.has(name.toLowerCase());
}

