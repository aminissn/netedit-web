import { spawn } from "child_process";
import { constants } from "fs";
import { mkdtemp, readFile, rm, writeFile, access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { NextResponse } from "next/server";

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

export async function POST(req: Request) {
  const xml = await req.text();
  if (!xml || !xml.trim()) {
    return NextResponse.json(
      { error: "Request body must contain net.xml content." },
      { status: 400 }
    );
  }

  const workDir = await mkdtemp(join(tmpdir(), "netedit-netconvert-"));
  const inputPath = join(workDir, "input.net.xml");
  const outputPath = join(workDir, "output.net.xml");
  const netconvertCandidates = await resolveNetconvertCandidates();

  try {
    await writeFile(inputPath, xml, "utf8");

    const args = [
      "--sumo-net-file",
      inputPath,
      "--output-file",
      outputPath,
    ];

    let lastSpawnError = "";
    for (const netconvertBin of netconvertCandidates) {
      try {
        const result = await runCommand(netconvertBin, args);
        if (result.code !== 0) {
          return NextResponse.json(
            {
              error: "netconvert failed",
              details: result.stderr || result.stdout || `Exit code ${result.code}`,
              bin: netconvertBin,
            },
            { status: 500 }
          );
        }

        const outputXml = await readFile(outputPath, "utf8");
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
