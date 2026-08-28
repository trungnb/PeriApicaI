const fs = require('fs');

let content = fs.readFileSync('src/components/AdminPortalModal.tsx', 'utf-8');

// Replace imports
content = content.replace(
  "import { useAdminAuth } from './admin/hooks/useAdminAuth';",
  "import { useAdminAuth } from './admin/hooks/useAdminAuth';\nimport { useAdminData } from './admin/hooks/useAdminData';"
);

// We need to replace the state variables and functions that were moved.
// This requires a careful regex or string replacements.
