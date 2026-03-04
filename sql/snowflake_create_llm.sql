-- =============================================
-- Snowflake Setup: User + Role + Warehouse for Cortex LLM Inference
-- Perfect for Vercel AI SDK (Cortex Chat Completions API)
-- Run as ACCOUNTADMIN
-- =============================================

USE ROLE ACCOUNTADMIN;

-- 1. Create dedicated warehouse (MEDIUM is recommended for LLM inference)
CREATE WAREHOUSE IF NOT EXISTS CORTEX_LLM_WH
  WAREHOUSE_SIZE = 'MEDIUM'
  AUTO_SUSPEND = 300          -- 5 minutes
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT = 'Dedicated warehouse for Cortex LLM inference (Vercel AI SDK)';

-- 2. Create custom role (least-privilege best practice)
CREATE ROLE IF NOT EXISTS CORTEX_LLM_ROLE
  COMMENT = 'Role for Cortex LLM inference (SQL + REST API / AI SDK)';

-- 3. Required grants for LLM inference
GRANT USAGE, OPERATE ON WAREHOUSE CORTEX_LLM_WH 
   TO ROLE CORTEX_LLM_ROLE;

-- These two are MANDATORY for all Cortex LLM functions + Chat Completions API
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER 
   TO ROLE CORTEX_LLM_ROLE;

GRANT USE AI FUNCTIONS ON ACCOUNT 
   TO ROLE CORTEX_LLM_ROLE;

-- 4. Create service user (TYPE = SERVICE is best for API use)
CREATE USER IF NOT EXISTS CORTEX_API_USER
  TYPE = SERVICE
  DEFAULT_ROLE = CORTEX_LLM_ROLE
  DEFAULT_WAREHOUSE = CORTEX_LLM_WH
  DEFAULT_NAMESPACE = 'SNOWFLAKE'
  COMMENT = 'Service user for Vercel AI SDK + Snowflake Cortex LLM';

-- Assign role to user
GRANT ROLE CORTEX_LLM_ROLE TO USER CORTEX_API_USER;

-- 5. Create and assign network policy (required for PAT on service users)
CREATE NETWORK POLICY IF NOT EXISTS CORTEX_API_NETWORK_POLICY
  ALLOWED_IP_LIST = ('0.0.0.0/0')  -- Allow all IPs (restrict in production!)
  COMMENT = 'Network policy for Cortex API service user';

ALTER USER CORTEX_API_USER SET NETWORK_POLICY = CORTEX_API_NETWORK_POLICY;

-- =============================================
-- 6. Generate Programmatic Access Token (PAT) - REQUIRED for AI SDK
-- =============================================
ALTER USER CORTEX_API_USER
  ADD PROGRAMMATIC ACCESS TOKEN CORTEX_AI_SDK_PAT
    ROLE_RESTRICTION = 'CORTEX_LLM_ROLE'
    DAYS_TO_EXPIRY = 90                    -- change as needed (max 365)
    COMMENT = 'Token for Vercel AI SDK';

-- The query above will return a column `token_secret` → COPY THIS VALUE IMMEDIATELY!
-- You will use it as `apiKey` in your AI SDK configuration.

-- =============================================
-- Optional: Tighten security (recommended in production)
-- =============================================
-- REVOKE DATABASE ROLE SNOWFLAKE.CORTEX_USER FROM ROLE PUBLIC;
-- REVOKE USE AI FUNCTIONS ON ACCOUNT FROM ROLE PUBLIC;

-- =============================================
-- Verification
-- =============================================
SHOW GRANTS TO ROLE CORTEX_LLM_ROLE;
SHOW GRANTS TO USER CORTEX_API_USER;
SHOW WAREHOUSES LIKE 'CORTEX_LLM_WH';