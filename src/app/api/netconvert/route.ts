import { spawn } from "child_process";
import { constants } from "fs";
import { mkdtemp, readFile, rm, writeFile, access, mkdir, copyFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { NextResponse } from "next/server";

const DEBUG_DIR = resolve(process.cwd(), "public", "netconvert-debug");

export const runtime = "nodejs";

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveNetconvertCandidates(): Promise<string[]> {
  const candidates: string[] = [];
  const envBin = process.env.NETCONVERT_BIN?.trim();
  const sumoHome = process.env.SUMO_HOME?.trim();
  const home = process.env.HOME?.trim();

  if (envBin) {
    candidates.push(envBin);
  }
  if (sumoHome) {
    candidates.push(join(sumoHome, "bin", "netconvert"));
  }
  if (home) {
    candidates.push(join(home, "sumo", "bin", "netconvert"));
  }

  candidates.push("/opt/homebrew/bin/netconvert");
  candidates.push("/usr/local/bin/netconvert");
  candidates.push("/usr/bin/netconvert");
  candidates.push("netconvert");

  const resolved: string[] = [];
  for (const candidate of candidates) {
    if (candidate.includes("/")) {
      if (await isExecutable(candidate)) {
        resolved.push(candidate);
      }
      continue;
    }
    resolved.push(candidate);
  }
  return Array.from(new Set(resolved));
}

function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Accepts either:
 * 1. Plain XML body (legacy: full net.xml) with Content-Type: application/xml
 * 2. JSON body with patch files:
 *    { baseNetXML: string, nodXML?: string, edgXML?: string, conXML?: string, tllXML?: string }
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  const isJSON = contentType.includes("application/json");

  let baseNetXML: string;
  let nodXML: string | undefined;
  let edgXML: string | undefined;
  let conXML: string | undefined;
  let tllXML: string | undefined;

  if (isJSON) {
    const body = await req.json();
    baseNetXML = body.baseNetXML;
    nodXML = body.nodXML;
    edgXML = body.edgXML;
    conXML = body.conXML;
    tllXML = body.tllXML;

    if (!baseNetXML || !baseNetXML.trim()) {
      return NextResponse.json(
        { error: "baseNetXML is required." },
        { status: 400 }
      );
    }
  } else {
    // Legacy: plain XML body
    baseNetXML = await req.text();
    if (!baseNetXML || !baseNetXML.trim()) {
      return NextResponse.json(
        { error: "Request body must contain net.xml content." },
        { status: 400 }
      );
    }
  }

  const hasPatchFiles = !!(nodXML || edgXML || conXML || tllXML);

  const workDir = await mkdtemp(join(tmpdir(), "netedit-netconvert-"));
  const inputPath = join(workDir, "input.net.xml");
  const outputPath = join(workDir, "output.net.xml");
  const netconvertCandidates = await resolveNetconvertCandidates();

  try {
    await writeFile(inputPath, baseNetXML, "utf8");

    // Write patch files if present
    const nodPath = join(workDir, "patch.nod.xml");
    const edgPath = join(workDir, "patch.edg.xml");
    const conPath = join(workDir, "patch.con.xml");
    const tllPath = join(workDir, "patch.tll.xml");

    if (nodXML) await writeFile(nodPath, nodXML, "utf8");
    if (edgXML) await writeFile(edgPath, edgXML, "utf8");
    if (conXML) await writeFile(conPath, conXML, "utf8");
    if (tllXML) await writeFile(tllPath, tllXML, "utf8");

    // Build netconvert args
    const args = [
      "--sumo-net-file", inputPath,
      "--output-file", outputPath,
      "--no-turnarounds.tls",
      "--no-internal-links",
      "--offset.disable-normalization",
    ];

    if (hasPatchFiles) {
      // Patch mode: apply partial changes on top of base network
      if (nodXML) args.push("--node-files", nodPath);
      if (edgXML) args.push("--edge-files", edgPath);
      if (conXML) args.push("--connection-files", conPath);
      if (tllXML) args.push("--tllogic-files", tllPath);
    }

    // Save input files to public/netconvert-debug/ for inspection
    try {
      await mkdir(DEBUG_DIR, { recursive: true });
      await copyFile(inputPath, join(DEBUG_DIR, "input.net.xml"));
      if (nodXML) await copyFile(nodPath, join(DEBUG_DIR, "patch.nod.xml"));
      if (edgXML) await copyFile(edgPath, join(DEBUG_DIR, "patch.edg.xml"));
      if (conXML) await copyFile(conPath, join(DEBUG_DIR, "patch.con.xml"));
      if (tllXML) await copyFile(tllPath, join(DEBUG_DIR, "patch.tll.xml"));
    } catch (e) {
      console.warn("[netconvert] Failed to save debug files:", e);
    }

    let lastSpawnError = "";
    for (const netconvertBin of netconvertCandidates) {
      console.log(`[netconvert] ${netconvertBin} ${args.join(" ")}`);
      try {
        const result = await runCommand(netconvertBin, args);
        if (result.code !== 0) {
          // Combine both stdout and stderr for full error details
          const fullError = [
            result.stderr ? `STDERR:\n${result.stderr}` : "",
            result.stdout ? `STDOUT:\n${result.stdout}` : "",
            `Exit code: ${result.code}`,
          ]
            .filter(Boolean)
            .join("\n\n");
          
          return NextResponse.json(
            {
              error: "netconvert failed",
              details: fullError || `Exit code ${result.code}`,
              bin: netconvertBin,
              stderr: result.stderr,
              stdout: result.stdout,
              exitCode: result.code,
            },
            { status: 500 }
          );
        }

        const outputXml = await readFile(outputPath, "utf8");
        // Also save the output for inspection
        try {
          await writeFile(join(DEBUG_DIR, "output.net.xml"), outputXml, "utf8");
        } catch (e) {
          console.warn("[netconvert] Failed to save debug output:", e);
        }
        return new Response(outputXml, {
          status: 200,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound =
          message.includes("ENOENT") ||
          message.includes("not found") ||
          message.includes("spawn");
        if (!isNotFound) {
          return NextResponse.json(
            { error: "Failed to run netconvert", details: message, bin: netconvertBin },
            { status: 500 }
          );
        }
        lastSpawnError = message;
      }
    }

    return NextResponse.json(
      {
        error: "netconvert binary not found",
        details:
          lastSpawnError ||
          "No executable netconvert binary was found in known locations or current PATH.",
        tried: netconvertCandidates,
      },
      { status: 500 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json(
      { error: "Failed to run netconvert", details: message },
      { status: 500 }
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
