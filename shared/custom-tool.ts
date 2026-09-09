export function parseCustomTool(entry: string) {
  const field = (name: string) => entry.split(/\r?\n/).find((line) => line.startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? "";
  const name = field("Model Tool Name") || field("Tool Name");
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name)) throw new Error("Tool name must contain 1–40 letters, numbers, underscores, or hyphens.");
  const url = new URL(field("Base URL Pattern"));
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Tool URL must use HTTP or HTTPS.");
  const method = field("HTTP Method").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) throw new Error("Invalid HTTP method.");
  const timeout = field("Timeout") || "20s";
  if (!/^\d+(\.\d+)?s$/.test(timeout) || parseFloat(timeout) <= 0) throw new Error("Timeout must be a positive duration such as 20s.");
  if (field("Static Response") === "Enabled") throw new Error("Disable Static Response: a response message has not been configured.");
  if (field("Agent End Behavior") && field("Agent End Behavior") !== "Default") throw new Error("Choose Default for Agent End Behavior to sync this HTTP tool.");
  const parameters = entry.split(/\r?\n/).filter((line) => line.startsWith("- ")).map((line) => {
    const match = line.match(/^- (.+) \(([^,]+), ([^,]+), ([^,]+), (required|optional)\)(?:: (.*))?$/);
    if (!match) throw new Error("Invalid saved tool parameter. Recreate the parameter.");
    const [, parameterName, kind, location, type, required, description] = match;
    if (kind !== "Dynamic") throw new Error(`${kind} parameter ${parameterName} needs a value before it can sync. Use a Dynamic parameter.`);
    const mappedLocation = location.toLowerCase().replace(" string", "");
    if (!["string", "number", "integer", "boolean", "object", "array"].includes(type.toLowerCase())) throw new Error("Invalid parameter type.");
    if (!["body", "query", "header", "path"].includes(mappedLocation)) throw new Error("Invalid parameter location.");
    return { paramType: "dynamic", name: parameterName, location: mappedLocation, required: required === "required", schema: { type: type.toLowerCase(), description: description ?? "" } };
  });
  if (new Set(parameters.map((p) => p.name)).size !== parameters.length) throw new Error("Parameter names must be unique.");
  return { name, description: field("Description"), http_method: method, http_url: url.href, parameters, timeout };
}
