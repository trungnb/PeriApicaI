import { validateClassicOutput, validatePathologyOutput } from './semanticValidation';

function testSemantic() {
  const malformedClassic = { errors: [{ key: 'wrong_target_tooth', confidence: 150 }] };
  const validated = validateClassicOutput(malformedClassic);
  if (validated.errors[0].confidence !== 100) throw new Error("Should clamp confidence to 100");

  const malformedPathology = { pathologies: [{ key: 'caries', confidence: -10, polygon_points: [] }] };
  const valPath = validatePathologyOutput(malformedPathology);
  if (valPath.pathologies[0].confidence !== 0) throw new Error("Should clamp confidence to 0");
  
  console.log('✅ semanticValidation tests passed!');
}

testSemantic();
