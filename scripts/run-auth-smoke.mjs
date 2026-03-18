#!/usr/bin/env node

function fail(message, details) {
  const parts = [message];
  if (details) {
    parts.push(details);
  }
  console.error(parts.join("\n"));
  process.exit(1);
}

function parseArgs(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${key}`);
    }

    result[key] = value;
    index += 1;
  }

  return result;
}

function splitSetCookieHeader(headerValue) {
  if (!headerValue) {
    return [];
  }

  return headerValue.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g);
}

class CookieJar {
  #cookies = new Map();

  update(response) {
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : splitSetCookieHeader(response.headers.get("set-cookie"));

    for (const entry of setCookies) {
      const firstPart = entry.split(";")[0];
      const separatorIndex = firstPart.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = firstPart.slice(0, separatorIndex).trim();
      const value = firstPart.slice(separatorIndex + 1).trim();
      this.#cookies.set(key, value);
    }
  }

  headerValue() {
    return Array.from(this.#cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }
}

function summarizeBody(body) {
  if (!body) {
    return "";
  }

  const compact = body.replace(/\s+/g, " ").trim();
  if (compact.length <= 400) {
    return compact;
  }

  return `${compact.slice(0, 397)}...`;
}

async function parseJson(response, context) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    fail(
      `${context} returned invalid JSON`,
      error instanceof Error ? `${error.message}\n${summarizeBody(text)}` : summarizeBody(text)
    );
  }
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = args["base-url"];
const email = args.email;
const password = args.password;
const expectedRole = args["expected-role"];
const checkPath = args["check-path"] || "/orders";

if (!baseUrl) {
  fail("Missing required --base-url");
}

if (!email) {
  fail("Missing required --email");
}

if (!password) {
  fail("Missing required --password");
}

const jar = new CookieJar();

async function request(pathname, init = {}) {
  const headers = new Headers(init.headers || {});
  const cookieHeader = jar.headerValue();
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  const response = await fetch(new URL(pathname, baseUrl), {
    ...init,
    headers,
    redirect: init.redirect || "manual",
  });

  jar.update(response);
  return response;
}

const setupStatusResponse = await request("/api/setup/status");
if (!setupStatusResponse.ok) {
  fail(`Failed to fetch setup status (${setupStatusResponse.status})`);
}

const setupStatus = await parseJson(setupStatusResponse, "Setup status endpoint");
if (!setupStatus?.exists || !setupStatus?.configured) {
  fail("Setup status did not report a configured database", JSON.stringify(setupStatus, null, 2));
}

const csrfResponse = await request("/api/auth/csrf");
if (!csrfResponse.ok) {
  fail(`Failed to fetch CSRF token (${csrfResponse.status})`);
}

const csrfPayload = await parseJson(csrfResponse, "CSRF endpoint");
const csrfToken = csrfPayload?.csrfToken;
if (typeof csrfToken !== "string" || !csrfToken) {
  fail("CSRF endpoint did not return a csrfToken");
}

const form = new URLSearchParams({
  csrfToken,
  email,
  password,
  callbackUrl: new URL("/orders", baseUrl).toString(),
  json: "true",
});

const loginResponse = await request("/api/auth/callback/credentials?json=true", {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json, text/plain, */*",
  },
  body: form.toString(),
});

if (!loginResponse.ok && ![302, 303].includes(loginResponse.status)) {
  const body = await loginResponse.text();
  fail(`Credentials login failed (${loginResponse.status})`, summarizeBody(body));
}

const sessionResponse = await request("/api/auth/session");
if (!sessionResponse.ok) {
  fail(`Failed to fetch session after login (${sessionResponse.status})`);
}

const sessionPayload = await parseJson(sessionResponse, "Session endpoint");
if (sessionPayload?.user?.email !== email) {
  fail("Login did not produce the expected session email", JSON.stringify(sessionPayload, null, 2));
}

if (expectedRole && sessionPayload?.user?.role !== expectedRole) {
  fail(
    `Login did not produce the expected role (${expectedRole})`,
    JSON.stringify(sessionPayload, null, 2)
  );
}

const checkResponse = await request(checkPath);
if (!checkResponse.ok) {
  const body = await checkResponse.text();
  fail(
    `Authenticated ${checkPath} request failed (${checkResponse.status})`,
    summarizeBody(body)
  );
}
