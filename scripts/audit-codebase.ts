#!/usr/bin/env tsx
/**
 * Codebase Audit Script
 * Checks for errors, performance issues, and validates functions
 */

import { existsSync, readFileSync } from "fs";
import path from "path";

interface AuditIssue {
  file: string;
  line?: number;
  severity: "error" | "warning" | "info";
  category: "syntax" | "performance" | "error-handling" | "type-safety" | "logic";
  message: string;
  recommendation?: string;
}

const issues: AuditIssue[] = [];

function addIssue(issue: AuditIssue): void {
  issues.push(issue);
}

// Check for synchronous file operations
function checkSyncOperations(): void {
  const files = [
    "lib/cache.ts",
    "lib/packages-metadata.ts",
    "lib/bitsetCache.ts",
  ];
  
  files.forEach(function (file) {
    const filePath = path.join(process.cwd(), file);
    if (!existsSync(filePath)) return;
    
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    
    lines.forEach(function (line, index) {
      // Check for synchronous readFileSync in async contexts
      if (line.includes("readFileSync") && content.includes("async function")) {
        const funcMatch = content.substring(0, content.indexOf(line)).match(/async\s+function[^{]*\{/g);
        if (funcMatch && funcMatch.length > 0) {
          addIssue({
            file,
            line: index + 1,
            severity: "warning",
            category: "performance",
            message: "Synchronous readFileSync used in async function - could block event loop",
            recommendation: "Use fs.promises.readFile() or await fs.readFile() instead",
          });
        }
      }
      
      // Check for synchronous operations that could block
      if (line.includes("readdirSync") && content.includes("async function")) {
        addIssue({
          file,
          line: index + 1,
          severity: "warning",
          category: "performance",
          message: "Synchronous readdirSync used - could block event loop",
          recommendation: "Use fs.promises.readdir() instead",
        });
      }
    });
  });
}

// Check error handling in API routes
function checkErrorHandling(): void {
  const apiRoutes = [
    "app/api/health/route.ts",
    "app/api/categories/popular/route.ts",
    "app/api/meta/[pkg]/route.ts",
    "app/api/similar/[pkg]/route.ts",
    "app/api/reverse-deps/[pkg]/route.ts",
    "app/api/config/libraries-io/route.ts",
  ];
  
  apiRoutes.forEach(function (file) {
    const filePath = path.join(process.cwd(), file);
    if (!existsSync(filePath)) return;
    
    const content = readFileSync(filePath, "utf-8");
    
    // Check if async functions have try-catch
    const asyncFuncRegex = /export\s+async\s+function\s+\w+[^{]*\{/g;
    let match;
    while ((match = asyncFuncRegex.exec(content)) !== null) {
      const funcStart = match.index;
      const funcBody = content.substring(funcStart);
      
      // Find the function body (simplified - looks for matching braces)
      let braceCount = 0;
      let funcEnd = -1;
      for (let i = 0; i < funcBody.length; i += 1) {
        if (funcBody[i] === "{") braceCount += 1;
        if (funcBody[i] === "}") {
          braceCount -= 1;
          if (braceCount === 0) {
            funcEnd = funcStart + i;
            break;
          }
        }
      }
      
      if (funcEnd > 0) {
        const body = funcBody.substring(0, funcEnd - funcStart);
        
        // Check for try-catch
        if (!body.includes("try") && !body.includes("catch")) {
          const lineNum = content.substring(0, funcStart).split("\n").length;
          addIssue({
            file,
            line: lineNum,
            severity: "warning",
            category: "error-handling",
            message: "Async function without try-catch block - unhandled errors could crash the API",
            recommendation: "Wrap function body in try-catch or ensure errors are handled",
          });
        }
      }
    }
    
    // Check for .catch() without proper error handling
    if (content.includes(".catch(function ()") || content.includes(".catch(()")) {
      const catchRegex = /\.catch\s*\([^)]*\)/g;
      let catchMatch;
      while ((catchMatch = catchRegex.exec(content)) !== null) {
        const catchBody = content.substring(catchMatch.index, catchMatch.index + 100);
        if (catchBody.includes("return null") || catchBody.includes("return {}") || catchBody.includes("ignore")) {
          const lineNum = content.substring(0, catchMatch.index).split("\n").length;
          addIssue({
            file,
            line: lineNum,
            severity: "info",
            category: "error-handling",
            message: "Error caught but silently ignored - consider logging for debugging",
            recommendation: "Add console.error or logging for caught errors",
          });
        }
      }
    }
  });
}

// Check for potential memory leaks
function checkMemoryLeaks(): void {
  const files = [
    "lib/pypi.ts",
    "lib/pypi-stats.ts",
    "app/api/similar/[pkg]/route.ts",
  ];
  
  files.forEach(function (file) {
    const filePath = path.join(process.cwd(), file);
    if (!existsSync(filePath)) return;
    
    const content = readFileSync(filePath, "utf-8");
    
    // Check for globalThis usage
    if (content.includes("globalThis")) {
      const lines = content.split("\n");
      lines.forEach(function (line, index) {
        if (line.includes("globalThis")) {
          addIssue({
            file,
            line: index + 1,
            severity: "info",
            category: "performance",
            message: "Using globalThis for cache - ensure proper cleanup and size limits",
            recommendation: "Verify LRU cache has max size and TTL configured",
          });
        }
      });
    }
    
    // Check for unbounded arrays/maps
    if (content.includes("new Map()") || content.includes("new Set()")) {
      const lines = content.split("\n");
      lines.forEach(function (line, index) {
        if ((line.includes("new Map()") || line.includes("new Set()")) && 
            !content.substring(0, content.indexOf(line)).includes("max") &&
            !content.substring(0, content.indexOf(line)).includes("limit")) {
          addIssue({
            file,
            line: index + 1,
            severity: "warning",
            category: "performance",
            message: "Unbounded Map/Set - could grow indefinitely",
            recommendation: "Add size limits or use LRU cache",
          });
        }
      });
    }
  });
}

// Check for type safety issues
function checkTypeSafety(): void {
  const filePath = path.join(process.cwd(), "lib/cache.ts");
  if (!existsSync(filePath)) return;
  
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  
  lines.forEach(function (line, index) {
    // Check for implicit any in map functions
    if (line.includes(".map(async function (file)") && !line.includes(": string")) {
      addIssue({
        file: "lib/cache.ts",
        line: index + 1,
        severity: "error",
        category: "type-safety",
        message: "Parameter 'file' implicitly has 'any' type",
        recommendation: "Add type annotation: .map(async function (file: string)",
      });
    }
  });
}

// Check for null/undefined safety
function checkNullSafety(): void {
  const filePath = path.join(process.cwd(), "scripts/download-libraries-io-csv.ts");
  if (!existsSync(filePath)) return;
  
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  
  lines.forEach(function (line, index) {
    // Check for csvUrl usage without null check
    if (line.includes("csvUrl") && (line.includes(".split") || line.includes(".endsWith")) && 
        !content.substring(0, content.indexOf(line)).includes("csvUrl &&")) {
      const prevLines = content.substring(0, content.indexOf(line)).split("\n");
      const csvUrlDecl = prevLines.find(function (l) { return l.includes("csvUrl") && l.includes("="); });
      if (csvUrlDecl && csvUrlDecl.includes("| null")) {
        addIssue({
          file: "scripts/download-libraries-io-csv.ts",
          line: index + 1,
          severity: "error",
          category: "type-safety",
          message: "csvUrl could be null but used without null check",
          recommendation: "Add null check before using csvUrl",
        });
      }
    }
  });
}

// Check for performance issues in algorithms
function checkPerformance(): void {
  const filePath = path.join(process.cwd(), "lib/similar.ts");
  if (!existsSync(filePath)) return;
  
  const content = readFileSync(filePath, "utf-8");
  
  // Check for synchronous cache loading in async functions
  if (content.includes("loadReverseDepsCache()") && content.includes("async function getReverseDeps")) {
    addIssue({
      file: "lib/similar.ts",
      line: 109,
      severity: "warning",
      category: "performance",
      message: "Synchronous loadReverseDepsCache() called in async function - could block",
      recommendation: "Use loadReverseDepsCacheAsync() instead",
    });
  }
  
  // Check for potential N+1 patterns
  if (content.includes("Promise.all") && content.includes(".map") && content.includes("await")) {
    const lines = content.split("\n");
    lines.forEach(function (line, index) {
      if (line.includes(".map") && line.includes("await") && !line.includes("Promise.all")) {
        addIssue({
          file: "lib/similar.ts",
          line: index + 1,
          severity: "warning",
          category: "performance",
          message: "Sequential await in map - should use Promise.all for parallel execution",
          recommendation: "Wrap in Promise.all() for parallel execution",
        });
      }
    });
  }
}

// Main audit function
function runAudit(): void {
  console.log("🔍 Running codebase audit...\n");
  
  checkSyncOperations();
  checkErrorHandling();
  checkMemoryLeaks();
  checkTypeSafety();
  checkNullSafety();
  checkPerformance();
  
  // Group issues by severity
  const errors = issues.filter(function (i) { return i.severity === "error"; });
  const warnings = issues.filter(function (i) { return i.severity === "warning"; });
  const infos = issues.filter(function (i) { return i.severity === "info"; });
  
  console.log(`\n📊 Audit Results:\n`);
  console.log(`   ❌ Errors: ${errors.length}`);
  console.log(`   ⚠️  Warnings: ${warnings.length}`);
  console.log(`   ℹ️  Info: ${infos.length}`);
  console.log(`   📝 Total: ${issues.length}\n`);
  
  if (errors.length > 0) {
    console.log("❌ ERRORS:\n");
    errors.forEach(function (issue) {
      console.log(`   ${issue.file}:${issue.line || "?"}`);
      console.log(`   ${issue.message}`);
      if (issue.recommendation) {
        console.log(`   💡 ${issue.recommendation}`);
      }
      console.log("");
    });
  }
  
  if (warnings.length > 0) {
    console.log("⚠️  WARNINGS:\n");
    warnings.forEach(function (issue) {
      console.log(`   ${issue.file}:${issue.line || "?"}`);
      console.log(`   ${issue.message}`);
      if (issue.recommendation) {
        console.log(`   💡 ${issue.recommendation}`);
      }
      console.log("");
    });
  }
  
  if (infos.length > 0 && infos.length < 10) {
    console.log("ℹ️  INFO:\n");
    infos.forEach(function (issue) {
      console.log(`   ${issue.file}:${issue.line || "?"}`);
      console.log(`   ${issue.message}`);
      if (issue.recommendation) {
        console.log(`   💡 ${issue.recommendation}`);
      }
      console.log("");
    });
  }
  
  // Exit with error code if there are errors
  if (errors.length > 0) {
    process.exit(1);
  }
}

runAudit();

