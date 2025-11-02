/* eslint-disable no-console */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fetchPackageMeta, pickLatestDependencies } from "../lib/pypi";

type VerificationResult = {
  pkg: string;
  pypiValid: boolean;
  sharedDepsVerified: number;
  cooccurValid: boolean;
  similarValid: boolean;
  errors: string[];
};

// Helper to get project root
function getProjectRoot(): string {
  const cwd = process.cwd();
  const dataPath = path.join(cwd, "data", "popular.json");
  if (existsSync(dataPath)) return cwd;
  try {
    const parentPath = path.resolve(cwd, "..", "data", "popular.json");
    if (existsSync(parentPath)) return path.resolve(cwd, "..");
  } catch {
    // Continue
  }
  return cwd;
}

async function verifyCooccurrenceAgainstPyPI(
  pkg: string,
  cooccurPackages: Array<{ name: string; sharedDependents: number }>,
  limit: number = 5
): Promise<{ valid: number; invalid: number; details: Array<{ name: string; expectedShared: number; actualShared: number; valid: boolean }> }> {
  try {
    const pkgMeta = await fetchPackageMeta(pkg);
    const pkgDeps = pickLatestDependencies(pkgMeta);
    const pkgDepsSet = new Set<string>(pkgDeps.map(function (d) { return d.toLowerCase(); }));
    
    const details: Array<{ name: string; expectedShared: number; actualShared: number; valid: boolean }> = [];
    let valid = 0;
    let invalid = 0;
    
    for (let i = 0; i < Math.min(limit, cooccurPackages.length); i += 1) {
      const cooccur = cooccurPackages[i];
      try {
        const cooccurMeta = await fetchPackageMeta(cooccur.name);
        const cooccurDeps = pickLatestDependencies(cooccurMeta);
        const cooccurDepsSet = new Set<string>(cooccurDeps.map(function (d) { return d.toLowerCase(); }));
        
        // Count actual shared dependencies
        let actualShared = 0;
        for (const dep of pkgDepsSet) {
          if (cooccurDepsSet.has(dep)) {
            actualShared += 1;
          }
        }
        
        const isValid = actualShared > 0 || cooccur.sharedDependents === 0;
        if (isValid && actualShared > 0) valid += 1;
        if (!isValid) invalid += 1;
        
        details.push({
          name: cooccur.name,
          expectedShared: cooccur.sharedDependents,
          actualShared: actualShared,
          valid: isValid,
        });
        
        await new Promise(function (resolve) { setTimeout(resolve, 150); });
      } catch (err) {
        details.push({
          name: cooccur.name,
          expectedShared: cooccur.sharedDependents,
          actualShared: -1,
          valid: false,
        });
        invalid += 1;
      }
    }
    
    return { valid, invalid, details };
  } catch (err) {
    return { valid: 0, invalid: 0, details: [] };
  }
}

async function verifyPackageAgainstThirdParty(pkg: string, testResult: any): Promise<VerificationResult> {
  const result: VerificationResult = {
    pkg,
    pypiValid: false,
    sharedDepsVerified: 0,
    cooccurValid: false,
    similarValid: false,
    errors: [],
  };
  
  try {
    // 1. Verify package exists on PyPI and get its dependencies
    console.log(`\nVerifying ${pkg}...`);
    const meta = await fetchPackageMeta(pkg);
    if (meta && meta.info) {
      result.pypiValid = true;
      const deps = pickLatestDependencies(meta);
      console.log(`  ✓ Package exists on PyPI with ${deps.length} dependencies`);
      if (deps.length > 0) {
        console.log(`  Sample deps: ${deps.slice(0, 5).join(", ")}`);
      }
      
      // 2. Fetch actual co-occurrence results from our API
      if (testResult.cooccurCount > 0) {
        console.log(`  Fetching ${testResult.cooccurCount} co-occurrence results from API...`);
        try {
          const apiResponse = await fetch(`http://localhost:3000/api/similar/${encodeURIComponent(pkg)}?limit=20`);
          const apiData = await apiResponse.json();
          const cooccurList = apiData.cooccur || [];
          
          if (cooccurList.length > 0) {
            console.log(`  Verifying ${Math.min(5, cooccurList.length)} co-occurrence results against PyPI...`);
            const verification = await verifyCooccurrenceAgainstPyPI(pkg, cooccurList.map(function (c: any) {
              return { name: c.name, sharedDependents: c.sharedDependents || 0 };
            }), 5);
            
            result.sharedDepsVerified = verification.valid;
            result.cooccurValid = verification.valid > 0 || verification.details.length === 0;
            
            console.log(`    ✓ Verified: ${verification.valid}/${verification.details.length} packages have shared dependencies`);
            verification.details.forEach(function (detail) {
              if (detail.valid && detail.actualShared > 0) {
                console.log(`      ✓ ${detail.name}: ${detail.actualShared} shared deps`);
              } else if (detail.actualShared === 0) {
                console.log(`      ⚠ ${detail.name}: No shared deps (may be name-based match)`);
              } else {
                console.log(`      ✗ ${detail.name}: Verification failed`);
              }
            });
          } else {
            console.log(`    ⚠ No co-occurrence results to verify`);
          }
        } catch (err) {
          console.log(`    ⚠ Could not fetch from API (is server running?): ${(err as Error).message}`);
          // Try computing directly
          const { computeCooccurrence } = await import("../lib/similar");
          const cooccur = await computeCooccurrence(pkg, 5, { maxDependentsToScan: 50 });
          if (cooccur.length > 0) {
            const verification = await verifyCooccurrenceAgainstPyPI(pkg, cooccur, 5);
            result.sharedDepsVerified = verification.valid;
            result.cooccurValid = verification.valid > 0;
            console.log(`    ✓ Verified ${verification.valid}/${verification.details.length} co-occurring packages`);
          }
        }
      }
      
      // 3. Fetch actual similar results and verify dependencies overlap
      if (testResult.similarCount > 0) {
        console.log(`  Fetching ${testResult.similarCount} similar results...`);
        try {
          const { computeSimilarOnDemand } = await import("../lib/similar");
          const similar = await computeSimilarOnDemand(pkg, 5, {
            restrictToPeerGroup: false,
            topSearchLimit: 50,
            maxDependentsToScan: 50,
            maxLiveCandidates: 50,
          });
          
          if (similar.length > 0) {
            console.log(`  Verifying ${Math.min(3, similar.length)} similar packages against PyPI...`);
            let verifiedSimilar = 0;
            
            for (let i = 0; i < Math.min(3, similar.length); i += 1) {
              const similarPkg = similar[i];
              try {
                const similarMeta = await fetchPackageMeta(similarPkg.name);
                const similarDeps = pickLatestDependencies(similarMeta);
                const similarDepsSet = new Set<string>(similarDeps.map(function (d) { return d.toLowerCase(); }));
                const pkgDepsSet = new Set<string>(deps.map(function (d) { return d.toLowerCase(); }));
                
                // Check if they share any dependencies
                let shared = 0;
                const sharedList: string[] = [];
                for (const dep of pkgDepsSet) {
                  if (similarDepsSet.has(dep)) {
                    shared += 1;
                    sharedList.push(dep);
                  }
                }
                
                if (shared > 0) {
                  verifiedSimilar += 1;
                  console.log(`      ✓ ${similarPkg.name}: Shares ${shared} dependencies (${sharedList.slice(0, 3).join(", ")})`);
                } else {
                  console.log(`      ⚠ ${similarPkg.name}: No shared dependencies (may be reverse deps similarity)`);
                }
                
                await new Promise(function (resolve) { setTimeout(resolve, 150); });
              } catch (err) {
                console.log(`      ✗ ${similarPkg.name}: Failed to verify - ${(err as Error).message}`);
              }
            }
            
            result.similarValid = verifiedSimilar > 0;
          }
        } catch (err) {
          console.log(`    ⚠ Could not compute similar: ${(err as Error).message}`);
        }
      }
      
    } else {
      result.errors.push("Package not found on PyPI");
    }
  } catch (err) {
    result.errors.push((err as Error).message || String(err));
  }
  
  return result;
}

async function main(): Promise<void> {
  const projectRoot = getProjectRoot();
  const testResultsPath = path.join(projectRoot, "data", "test-results.json");
  
  if (!existsSync(testResultsPath)) {
    console.error(`Test results file not found`);
    process.exit(1);
  }
  
  const testResults: any[] = JSON.parse(readFileSync(testResultsPath, "utf-8"));
  
  // Select diverse packages for verification
  const packagesToVerify: string[] = [];
  
  // Package with both similar and co-occurrence
  const withBoth = testResults.find(function (r) { return r.similarCount > 0 && r.cooccurCount > 0; });
  if (withBoth) packagesToVerify.push(withBoth.pkg);
  
  // Package with only co-occurrence
  const withOnlyCooccur = testResults.find(function (r) { return r.similarCount === 0 && r.cooccurCount > 5; });
  if (withOnlyCooccur) packagesToVerify.push(withOnlyCooccur.pkg);
  
  // Package with only similar
  const withOnlySimilar = testResults.find(function (r) { return r.similarCount > 0 && r.cooccurCount === 0; });
  if (withOnlySimilar) packagesToVerify.push(withOnlySimilar.pkg);
  
  // Popular packages
  packagesToVerify.push("requests");
  packagesToVerify.push("django");
  packagesToVerify.push("flask");
  packagesToVerify.push("numpy");
  
  // Remove duplicates
  const uniquePackages = Array.from(new Set(packagesToVerify));
  
  console.log(`\n=== Third-Party Verification Report ===`);
  console.log(`Verifying ${uniquePackages.length} packages against PyPI API\n`);
  
  const verificationResults: VerificationResult[] = [];
  
  for (let i = 0; i < uniquePackages.length; i += 1) {
    const pkg = uniquePackages[i];
    const testResult = testResults.find(function (r) { return r.pkg === pkg; });
    
    if (!testResult) {
      console.log(`\n${pkg}: Test result not found, skipping...`);
      continue;
    }
    
    const verification = await verifyPackageAgainstThirdParty(pkg, testResult);
    verificationResults.push(verification);
    
    if (i < uniquePackages.length - 1) {
      await new Promise(function (resolve) { setTimeout(resolve, 2000); });
    }
  }
  
  // Summary
  console.log(`\n\n=== VERIFICATION SUMMARY ===`);
  const totalVerified = verificationResults.length;
  const pypiValid = verificationResults.filter(function (r) { return r.pypiValid; }).length;
  const cooccurValid = verificationResults.filter(function (r) { return r.cooccurValid; }).length;
  const similarValid = verificationResults.filter(function (r) { return r.similarValid; }).length;
  const totalSharedDeps = verificationResults.reduce(function (sum, r) { return sum + r.sharedDepsVerified; }, 0);
  
  console.log(`Total packages verified: ${totalVerified}`);
  console.log(`Packages found on PyPI: ${pypiValid} (${Math.round((pypiValid / totalVerified) * 100)}%)`);
  console.log(`Co-occurrence results validated: ${cooccurValid}/${verificationResults.filter(function (r) { return r.pypiValid; }).length}`);
  console.log(`Similar results validated: ${similarValid}/${verificationResults.filter(function (r) { return r.pypiValid; }).length}`);
  console.log(`Total shared dependencies verified: ${totalSharedDeps}`);
  
  console.log(`\n=== DETAILED RESULTS ===`);
  verificationResults.forEach(function (r) {
    console.log(`\n${r.pkg}:`);
    console.log(`  PyPI valid: ${r.pypiValid ? "✓" : "✗"}`);
    console.log(`  Co-occurrence valid: ${r.cooccurValid ? "✓" : (r.pypiValid ? "⚠" : "N/A")}`);
    console.log(`  Similar valid: ${r.similarValid ? "✓" : (r.pypiValid ? "⚠" : "N/A")}`);
    console.log(`  Shared deps verified: ${r.sharedDepsVerified}`);
    if (r.errors.length > 0) {
      console.log(`  Errors: ${r.errors.join(", ")}`);
    }
  });
}

main().catch(function (e) {
  console.error("Fatal error:", e);
  process.exit(1);
});

