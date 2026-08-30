import { PATHOLOGY_DICT } from '../constants/dictionaries';

export function validateClassicOutput(parsed: any): any {
  if (!parsed || typeof parsed !== 'object') return parsed;
  
  const validErrors: any[] = [];
  const seenKeys = new Set<string>();

  if (Array.isArray(parsed.errors)) {
    for (const err of parsed.errors) {
      if (!err || typeof err !== 'object') continue;
      const key = err.errorKey || err.key;
      if (typeof key !== 'string') continue;
      
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        // Clamp confidence
        let conf = Number(err.confidence);
        if (isNaN(conf)) conf = 85;
        if (conf < 0) conf = 0;
        if (conf > 100) conf = 100;
        
        validErrors.push({
          ...err,
          confidence: conf
        });
      }
    }
  }

  return {
    ...parsed,
    errors: validErrors.slice(0, 15) // Limit number of findings
  };
}

export function validatePathologyOutput(parsed: any): any {
  if (!parsed || typeof parsed !== 'object') return parsed;

  const validPathologies: any[] = [];
  
  if (Array.isArray(parsed.pathologies)) {
    for (const p of parsed.pathologies) {
      if (!p || typeof p !== 'object') continue;
      
      const key = p.key;
      if (typeof key !== 'string' || !PATHOLOGY_DICT[key]) {
        // Must belong to taxonomy
        continue;
      }

      // Clamp confidence
      let conf = Number(p.confidence);
      if (isNaN(conf)) conf = 85;
      if (conf < 0) conf = 0;
      if (conf > 100) conf = 100;
      
      validPathologies.push({
        ...p,
        confidence: conf
      });
    }
  }
  
  let obs = parsed.observationChain;
  if (Array.isArray(obs)) {
    obs = obs.slice(0, 20); // limit length
  } else {
    obs = [];
  }

  return {
    ...parsed,
    pathologies: validPathologies,
    observationChain: obs
  };
}
