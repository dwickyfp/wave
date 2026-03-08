# Changelog

## 1.0.0 (2026-03-08)


### Features

* **a2a-agent:** implement A2A agent repository and configuration types ([5e4c1c4](https://github.com/dwickyfp/wave/commit/5e4c1c4014e6477950035df8bac1fc336b8fb6a8))
* add admin usage monitoring feature with internationalization support ([fe42bd3](https://github.com/dwickyfp/wave/commit/fe42bd346ab7ed4a190618a20539e47e57c89e68))
* add Azure OpenAI provider support with custom settings validation ([389ea28](https://github.com/dwickyfp/wave/commit/389ea28c60b3e25d488bf9951c2d43e3400e136f))
* add comprehensive documentation for AI SDK, including common errors, dev tools, and type-safe agents ([73da6a9](https://github.com/dwickyfp/wave/commit/73da6a9d98b65a6e344f37c9a2987ea8769048a4))
* Add ContextX LLM parsing and retrieval threshold to knowledge groups ([3efba53](https://github.com/dwickyfp/wave/commit/3efba53ccc9a228ddf21dc5969466d92bbde84f7))
* add dev warmup script to pre-compile static routes for faster development ([2cea8b5](https://github.com/dwickyfp/wave/commit/2cea8b508840e03a6dee26b188f218c01bb440b1))
* add document metadata extraction and normalization utilities ([b7daae2](https://github.com/dwickyfp/wave/commit/b7daae2d274ca14c987e7aeff4881d409fbe1fc2))
* add edit functionality for knowledge groups and improve UI for empty states ([e982fd7](https://github.com/dwickyfp/wave/commit/e982fd7da41d50b718498d7c55eda32d6212456c))
* add external agent model ID sanitization and loading tools for wave agents ([e3d3766](https://github.com/dwickyfp/wave/commit/e3d37663b2e7d4dfb0285364d8c81077d365b1b7))
* add icon assets and tests for Emma Pilot extension ([d7107ad](https://github.com/dwickyfp/wave/commit/d7107adb431b22316e125f9bb70bb07c93b911a7))
* add icon support to Snowflake agent creation and form ([8d22fae](https://github.com/dwickyfp/wave/commit/8d22faedfd2d0e13f033e982e2ba5aa779df02e2))
* add MCP key management for agents ([cbc8332](https://github.com/dwickyfp/wave/commit/cbc8332df088df8962e3de9bfb04190bfac91f01))
* add message feedback functionality with like/dislike options ([b167a52](https://github.com/dwickyfp/wave/commit/b167a5254ab181c0e50130428b284fb98073a45b))
* add NVM initialization to pre-commit hook for consistent environment setup ([268f6df](https://github.com/dwickyfp/wave/commit/268f6dff7a9c568236849d651a4fc7c59d5508ce))
* add Redis and file storage settings management ([b99673f](https://github.com/dwickyfp/wave/commit/b99673fa0b3dca2356421b4ec9b87d93b9ddc9d2))
* add rendering function for user text with tool mentions in messages ([a107c03](https://github.com/dwickyfp/wave/commit/a107c032d3bda7ce8fa4110b72d9650c67a80f09))
* Add Snowflake icon component and integrate into model provider icon ([90005d5](https://github.com/dwickyfp/wave/commit/90005d523944d40295556fd59b3cb8aa3ecefdd4))
* add streaming support for pilot chat and continuation ([08c3fc7](https://github.com/dwickyfp/wave/commit/08c3fc7afb1952b942e6c01733433dfa299305d8))
* add support for model pricing and generation capabilities ([d517432](https://github.com/dwickyfp/wave/commit/d517432d952bc946bb13b8aaf869d7a9b94a4afa))
* add support for multiple model types in image generation ([d642c8c](https://github.com/dwickyfp/wave/commit/d642c8cfe58ba1fc23cf380bd090cdd3f89ec161))
* add support for source groups in knowledge management ([d144e74](https://github.com/dwickyfp/wave/commit/d144e74e14de1089409c2f142c56b54a43724f3a))
* add thread branching functionality and improve timezone handling ([4a852cc](https://github.com/dwickyfp/wave/commit/4a852cc320ae69abc6ac339f19b9a4cc196915cb))
* add usage charts for model distribution and top users in usage monitoring ([29b4e56](https://github.com/dwickyfp/wave/commit/29b4e5601e4487cd7089ebf1903a929f3e188569))
* add VegaLiteChart component for rendering Vega-Lite visualizations ([b926e48](https://github.com/dwickyfp/wave/commit/b926e4860e617f2fe9ac93174390dd2f71d0fb3b))
* add visual context handling for pilot models ([77c1614](https://github.com/dwickyfp/wave/commit/77c1614c0c2bc215ffaafe7c582608e951f1c54a))
* **agent:** add import/export functionality for agents with JSON support ([2442c3e](https://github.com/dwickyfp/wave/commit/2442c3ee5dc9af3b709357460d3ee1150be1a4ea))
* **chat:** optimize message handling and improve footer action visibility ([d5f299b](https://github.com/dwickyfp/wave/commit/d5f299b84a9f4600e974cb7862c5c4bdc62e91ff))
* enhance A2A and MCP key management with shared access key support ([be99ca6](https://github.com/dwickyfp/wave/commit/be99ca60a701f2dbc741f40fb981c2b793f5a8dd))
* enhance A2A publish panel with embedded mode support in edit agent ([62aa763](https://github.com/dwickyfp/wave/commit/62aa7639e28790992630b0385ea52c342b394e02))
* enhance admin sidebar functionality with toggle state and improved active link handling ([d2f222b](https://github.com/dwickyfp/wave/commit/d2f222b1b6a3bde955657709311d049804ba92e2))
* enhance agent dashboard session handling and transcript features ([bd46299](https://github.com/dwickyfp/wave/commit/bd46299fa69133c351b2c413f36cb06af3db25a4))
* enhance authentication to accept multiple header formats for agent keys ([00dcfb1](https://github.com/dwickyfp/wave/commit/00dcfb121ac4c8eacc9b2d6026b10cf8417a5ab0))
* enhance chat repository and Snowflake integration ([7d5f9ed](https://github.com/dwickyfp/wave/commit/7d5f9ede4bc01bc27f6204578a5a1a549088d358))
* enhance Docker setup and add tests for Emma Pilot packaging ([1d5fae6](https://github.com/dwickyfp/wave/commit/1d5fae631109a8e0781c4a22feb38534042df632))
* enhance feedback submission for AssistMessagePart with error handling ([8908bc1](https://github.com/dwickyfp/wave/commit/8908bc14059a3c0bebc29760d69db43f7494c617))
* enhance file uploader and access control ([13ae6db](https://github.com/dwickyfp/wave/commit/13ae6db93ed176cac0cd98e519399de448276366))
* enhance knowledge processing with contextual enrichment and improved embedding ([6e450b2](https://github.com/dwickyfp/wave/commit/6e450b2f6290359313ef9d312d28dacda6a74d93))
* Enhance MarkdownTable component with pagination and Excel export functionality ([8dc2bca](https://github.com/dwickyfp/wave/commit/8dc2bcaa95949f191d537603352a4e595489beb3))
* enhance model editing functionality by setting UI and API names on edit ([52c1219](https://github.com/dwickyfp/wave/commit/52c1219cdf2ff302763b14338733c35ef83c49ed))
* Enhance Snowflake streaming with detailed event handling and logging ([5866eb2](https://github.com/dwickyfp/wave/commit/5866eb2e807a65799a79135a586e8fdb9a44d064))
* Enhance visibility management in KnowledgeCard and KnowledgeList components ([11fd88d](https://github.com/dwickyfp/wave/commit/11fd88d9c8119090c70a37da88f0d1a2c8e8f545))
* **image:** integrate Google image generation and update related tools ([cfabcd2](https://github.com/dwickyfp/wave/commit/cfabcd284471d26e8383be62720d4bc79b0d09f7))
* implement aborted response notice handling in chat API and UI components ([8c5f8c3](https://github.com/dwickyfp/wave/commit/8c5f8c38b7e2d31165c2a40169f1895a45a37ab0))
* Implement Context7-style full-document retrieval and ContextX model configuration ([da0ef49](https://github.com/dwickyfp/wave/commit/da0ef49d3b4b3f5aecbd92497687c93d41122597))
* implement knowledge processing and embedding features ([0ce7bf2](https://github.com/dwickyfp/wave/commit/0ce7bf22ba3f5c947fdae5945849602fd17ca258))
* implement knowledge section graph and context enrichment ([72cd2c8](https://github.com/dwickyfp/wave/commit/72cd2c8de3a49b0c198740c89d550038d541e86c))
* implement parallel subagent handling and UI components for improved agent processing ([bbe7887](https://github.com/dwickyfp/wave/commit/bbe78877146607261a8f95876f8d940518d4714c))
* implement provider compatibility functions and tests for message sanitization ([ec5c1ab](https://github.com/dwickyfp/wave/commit/ec5c1aba2ba0c9f07ed2e68896d5628c684ea9c7))
* implement skill management features including creation, editing, visibility control, and deletion ([ac7a5b9](https://github.com/dwickyfp/wave/commit/ac7a5b9a164a1b03bcca32062eedf7027a89496d))
* Implement Snowflake Agent Repository and Authentication ([6be9ca6](https://github.com/dwickyfp/wave/commit/6be9ca6a575c68013231a14e982af91d35db9ebd))
* implement usage monitoring API and admin user management ([fbbd381](https://github.com/dwickyfp/wave/commit/fbbd381c3034378131e827e3d764550bfa27bbf1))
* improve forkThreadAction to handle message cutoff with error handling ([08864cd](https://github.com/dwickyfp/wave/commit/08864cdcc6d0837a1e71508248dbfdafb57722bd))
* increase concurrency for knowledge ingestion worker to improve processing efficiency ([7aef165](https://github.com/dwickyfp/wave/commit/7aef165abd51b37717af795ab61c67f6b4b52043))
* Increase maximum rows for rendered markdown table from 50 to 1500 ([10e986f](https://github.com/dwickyfp/wave/commit/10e986f21ad687af51c961199f0d6ce143462c8f))
* integrate vega-embed for improved chart rendering and adjust loading indicator styles ([d3bc839](https://github.com/dwickyfp/wave/commit/d3bc8396cc567222a80d1bd16ea03a1d6139f7fc))
* **knowledge:** add knowledge management features including context retrieval and playground tab ([575bda7](https://github.com/dwickyfp/wave/commit/575bda776856850f3769216076cbcd74d3487f46))
* **migrations:** update model_type column definition and adjust journal entry timestamp ([bc0f5f3](https://github.com/dwickyfp/wave/commit/bc0f5f303fc6edb1a5149e6aec414b852ab090f4))
* **pilot:** enhance task management and form handling ([4e60560](https://github.com/dwickyfp/wave/commit/4e6056063d7959ca24aa403b4180e3d96eb7beea))
* **pilot:** implement browser actions and chat functionalities ([1b24c8b](https://github.com/dwickyfp/wave/commit/1b24c8bb4732d305b6dc7ff1dee17f186ad87912))
* **planning:** add comprehensive planning strategy document for ContextX engine ([4380819](https://github.com/dwickyfp/wave/commit/4380819b49bb1db0a9aa6d53e6434f26236e1da0))
* **provider:** add confirmation dialogs for provider and model deletion ([0968365](https://github.com/dwickyfp/wave/commit/0968365c2d53ac0fc9c5787ffbf74c0a587b171b))
* **provider:** add model editing functionality in ProviderConfigSheet ([4347afb](https://github.com/dwickyfp/wave/commit/4347afbb35ba28d79468e8a388200ef347865ee7))
* **provider:** add support for Cohere and Snowflake providers, including reranking model functionality ([18efadd](https://github.com/dwickyfp/wave/commit/18efaddcb7ec83ef201201ff13da9d0dbc43e65e))
* **provider:** enhance model display by grouping models by type in ProviderConfigSheet ([8239f9b](https://github.com/dwickyfp/wave/commit/8239f9b0acb7ced2a3e805d3f136550d09b9c3e7))
* **provider:** implement collapsible model type groups in ProviderConfigSheet ([da83c9d](https://github.com/dwickyfp/wave/commit/da83c9d94f6ecbeb08c8aea01bad122b07d49496))
* **query:** enhance knowledge retrieval with query expansion and adjacent chunk support ([c031531](https://github.com/dwickyfp/wave/commit/c031531a804f7a38ec39c1059c9efb844dd86617))
* refactor admin sidebar to improve transition effects for submenu visibility ([fd790e7](https://github.com/dwickyfp/wave/commit/fd790e70f71e98ce06039066198267d41c71b75f))
* Refactor knowledge components and enhance retrieval logic with improved model handling ([a8cfa19](https://github.com/dwickyfp/wave/commit/a8cfa192c5dd126320ce752d40f6ab30b6e1b283))
* Refactor KnowledgePlaygroundTab by removing unused code and simplifying document retrieval logic ([36dc8da](https://github.com/dwickyfp/wave/commit/36dc8dad0fdf75c493b236bffbcb2d389b184b4c))
* remove obsolete planning documentation for ContextX Engine ([7a707e3](https://github.com/dwickyfp/wave/commit/7a707e38c5804cbf531230ed85e55d4840159ac9))
* remove obsolete subproject for AI tools ([5dc4466](https://github.com/dwickyfp/wave/commit/5dc44661655eb3d9a8100e462ce5a9545df67b54))
* remove SSE logging functionality from Snowflake client ([3a2e6db](https://github.com/dwickyfp/wave/commit/3a2e6db415867a2fe1bcf8f794f42d1178e89ee8))
* **settings:** add cache revalidation for chat models after updates ([650df3f](https://github.com/dwickyfp/wave/commit/650df3fd9be0a95efda7350e0eada0497c2c940d))
* **settings:** add import/export functionality for settings backup ([5fdad66](https://github.com/dwickyfp/wave/commit/5fdad66590a2937837d58222d32fe05d36f30697))
* **settings:** add provider configuration management ([85a3b42](https://github.com/dwickyfp/wave/commit/85a3b42cdc48d90ee004400e872da63b5f24df33))
* update agent dropdown link for snowflake_cortex agent type ([1aa62ca](https://github.com/dwickyfp/wave/commit/1aa62caf758189bd0c33dc187fc2eb03dac5b713))
* update Emma Pilot with new features and improvements ([e21cd42](https://github.com/dwickyfp/wave/commit/e21cd426b6af4ca6f460b975f8ddf59e6936a0b3))
* update input placeholder text for improved clarity ([a02e4a7](https://github.com/dwickyfp/wave/commit/a02e4a7c111488206a8904a77580471137b8f2da))
* update sidebar header title from "wave-chatbot" to "emma-chatbot" ([093081b](https://github.com/dwickyfp/wave/commit/093081b3ee2853017e2c7fa4ffaaca10e42bebde))
* update terminology and descriptions for source ID resolution tools ([b9111b1](https://github.com/dwickyfp/wave/commit/b9111b17510ed935f7992adda35511c0b40c4c57))


### Bug Fixes

* Cast part to any in PurePreviewMessage for type compatibility ([dfbfc3b](https://github.com/dwickyfp/wave/commit/dfbfc3b111d3e71ec330ff3a52263af4dd2c834f))
* update grok-4-1-fast model reference to correct endpoint ([f50966e](https://github.com/dwickyfp/wave/commit/f50966e0c5d5fe9639472ba0415f11d661d2ba7c))

## [1.26.0](https://github.com/cgoinglove/better-chatbot/compare/v1.25.0...v1.26.0) (2025-11-07)


### Features

* add LaTeX/TeX math equation rendering support ([#318](https://github.com/cgoinglove/better-chatbot/issues/318)) ([c0a8b5b](https://github.com/cgoinglove/better-chatbot/commit/c0a8b5b9b28599716013c83cac03fa5745ffd403)) by @jezweb


### Bug Fixes

* hide MCP server credentials from non-owners ([#317](https://github.com/cgoinglove/better-chatbot/issues/317)) ([#319](https://github.com/cgoinglove/better-chatbot/issues/319)) ([6e32417](https://github.com/cgoinglove/better-chatbot/commit/6e32417535c27f1215f96d68b7302dba4a1b904d)) by @jezweb

## [1.25.0](https://github.com/cgoinglove/better-chatbot/compare/v1.24.0...v1.25.0) (2025-10-30)


### Features

* s3 storage and richer file support ([#301](https://github.com/cgoinglove/better-chatbot/issues/301)) ([051a974](https://github.com/cgoinglove/better-chatbot/commit/051a9740a6ecf774bfead9ce327c376ea5b279a5)) by @mrjasonroy


### Bug Fixes

* model name for gpt-4.1-mini in staticModels ([#299](https://github.com/cgoinglove/better-chatbot/issues/299)) ([4513ac0](https://github.com/cgoinglove/better-chatbot/commit/4513ac0e842f588a24d7075af8700e3cc7a3eb39)) by @mayur9210

## [1.24.0](https://github.com/cgoinglove/better-chatbot/compare/v1.23.0...v1.24.0) (2025-10-06)


### Features

* generate image Tool (Nano Banana) ([#284](https://github.com/cgoinglove/better-chatbot/issues/284)) ([984ce66](https://github.com/cgoinglove/better-chatbot/commit/984ce665ceef7225870f4eb751afaf65bf8a2dd4)) by @cgoinglove
* openai image generate ([#287](https://github.com/cgoinglove/better-chatbot/issues/287)) ([0deef6e](https://github.com/cgoinglove/better-chatbot/commit/0deef6e8a83196afb1f44444ab2f13415de20e73)) by @cgoinglove

## [1.23.0](https://github.com/cgoinglove/better-chatbot/compare/v1.22.0...v1.23.0) (2025-10-04)


### Features

* export chat thread ([#278](https://github.com/cgoinglove/better-chatbot/issues/278)) ([23e79cd](https://github.com/cgoinglove/better-chatbot/commit/23e79cd570c24bab0abc496eca639bfffcb6060b)) by @cgoinglove
* **file-storage:** image uploads, generate profile with ai ([#257](https://github.com/cgoinglove/better-chatbot/issues/257)) ([46eb43f](https://github.com/cgoinglove/better-chatbot/commit/46eb43f84792d48c450f3853b48b24419f67c7a1)) by @brrock


### Bug Fixes

* Apply DISABLE_SIGN_UP to OAuth providers ([#282](https://github.com/cgoinglove/better-chatbot/issues/282)) ([bcc0db8](https://github.com/cgoinglove/better-chatbot/commit/bcc0db8eb81997e54e8904e64fc76229fbfc1338)) by @cgoing-bot
* ollama disable issue ([#283](https://github.com/cgoinglove/better-chatbot/issues/283)) ([5e0a690](https://github.com/cgoinglove/better-chatbot/commit/5e0a690bb6c3f074680d13e09165ca9fff139f93)) by @cgoinglove

## [1.22.0](https://github.com/cgoinglove/better-chatbot/compare/v1.21.0...v1.22.0) (2025-09-25)

### Features

- admin and roles ([#270](https://github.com/cgoinglove/better-chatbot/issues/270)) ([63bddca](https://github.com/cgoinglove/better-chatbot/commit/63bddcaa4bc62bc85204a0982a06f2bed09fc5f5)) by @mrjasonroy
- groq provider ([#268](https://github.com/cgoinglove/better-chatbot/issues/268)) ([aef213d](https://github.com/cgoinglove/better-chatbot/commit/aef213d2f9dd0255996cc4184b03425db243cd7b)) by @cgoinglove
- hide LLM providers without API keys in model selection ([#269](https://github.com/cgoinglove/better-chatbot/issues/269)) ([63c15dd](https://github.com/cgoinglove/better-chatbot/commit/63c15dd386ea99b8fa56f7b6cb1e58e5779b525d)) by @cgoinglove
- **voice-chat:** binding agent tools ([#275](https://github.com/cgoinglove/better-chatbot/issues/275)) ([ed45e82](https://github.com/cgoinglove/better-chatbot/commit/ed45e822eb36447f2a02ef3aa69eeec88009e357)) by @cgoinglove

### Bug Fixes

- ensure PKCE works for MCP Server auth ([#256](https://github.com/cgoinglove/better-chatbot/issues/256)) ([09b938f](https://github.com/cgoinglove/better-chatbot/commit/09b938f17ca78993a1c7b84c5a702b95159542b2)) by @jvg123

## [1.21.0](https://github.com/cgoinglove/better-chatbot/compare/v1.20.2...v1.21.0) (2025-08-24)

### Features

- agent sharing ([#226](https://github.com/cgoinglove/better-chatbot/issues/226)) ([090dd8f](https://github.com/cgoinglove/better-chatbot/commit/090dd8f4bf4fb82beb2cd9bfa0b427425bbbf352)) by @mrjasonroy
- ai v5 ([#230](https://github.com/cgoinglove/better-chatbot/issues/230)) ([0461879](https://github.com/cgoinglove/better-chatbot/commit/0461879740860055a278c96656328367980fa533)) by @cgoinglove
- improve markdown table styling ([#244](https://github.com/cgoinglove/better-chatbot/issues/244)) ([7338e04](https://github.com/cgoinglove/better-chatbot/commit/7338e046196f72a7cc8ec7903593d94ecabcc05e)) by @hakonharnes

### Bug Fixes

- [#111](https://github.com/cgoinglove/better-chatbot/issues/111) prevent MCP server disconnection during long-running tool calls ([#238](https://github.com/cgoinglove/better-chatbot/issues/238)) ([b5bb3dc](https://github.com/cgoinglove/better-chatbot/commit/b5bb3dc40a025648ecd78f547e0e1a2edd8681ca)) by @cgoinglove

## [1.20.2](https://github.com/cgoinglove/better-chatbot/compare/v1.20.1...v1.20.2) (2025-08-09)

### Bug Fixes

- improve error display with better UX and animation handling ([#227](https://github.com/cgoinglove/better-chatbot/issues/227)) ([35d62e0](https://github.com/cgoinglove/better-chatbot/commit/35d62e05bb21760086c184511d8062444619696c)) by @cgoinglove
- **mcp:** ensure database and memory manager sync across server instances ([#229](https://github.com/cgoinglove/better-chatbot/issues/229)) ([c4b8ebe](https://github.com/cgoinglove/better-chatbot/commit/c4b8ebe9566530986951671e36111a2e529bf592)) by @cgoinglove

## [1.20.1](https://github.com/cgoinglove/better-chatbot/compare/v1.20.0...v1.20.1) (2025-08-06)

### Bug Fixes

- **mcp:** fix MCP infinite loading issue ([#220](https://github.com/cgoinglove/better-chatbot/issues/220)) ([c25e351](https://github.com/cgoinglove/better-chatbot/commit/c25e3515867c76cc5494a67e79711e9343196078)) by @cgoing-bot

## [1.20.0](https://github.com/cgoinglove/better-chatbot/compare/v1.19.1...v1.20.0) (2025-08-04)

### Features

- add qwen3 coder to models file for openrouter ([#206](https://github.com/cgoinglove/better-chatbot/issues/206)) ([3731d00](https://github.com/cgoinglove/better-chatbot/commit/3731d007100ac36a814704f8bde8398ce1378a4e)) by @brrock
- improve authentication configuration and social login handling ([#211](https://github.com/cgoinglove/better-chatbot/issues/211)) ([cd25937](https://github.com/cgoinglove/better-chatbot/commit/cd25937020710138ab82458e70ea7f6cabfd03ca)) by @mrjasonroy
- introduce interactive table creation and enhance visualization tools ([#205](https://github.com/cgoinglove/better-chatbot/issues/205)) ([623a736](https://github.com/cgoinglove/better-chatbot/commit/623a736f6895b8737acaa06811088be2dc1d0b3c)) by @cgoing-bot
- **mcp:** oauth ([#208](https://github.com/cgoinglove/better-chatbot/issues/208)) ([136aded](https://github.com/cgoinglove/better-chatbot/commit/136aded6de716367380ff64c2452d1b4afe4aa7f)) by @cgoinglove
- **web-search:** replace Tavily API with Exa AI integration ([#204](https://github.com/cgoinglove/better-chatbot/issues/204)) ([7140487](https://github.com/cgoinglove/better-chatbot/commit/7140487dcdadb6c5cb6af08f92b06d42411f7168)) by @cgoing-bot

### Bug Fixes

- implement responsive horizontal layout for chat mention input with improved UX And generate Agent Prompt ([43ec980](https://github.com/cgoinglove/better-chatbot/commit/43ec98059e0d27ab819491518263df55fb1c9ad3)) by @cgoinglove
- **mcp:** Safe MCP manager init logic for the Vercel environment ([#202](https://github.com/cgoinglove/better-chatbot/issues/202)) ([708fdfc](https://github.com/cgoinglove/better-chatbot/commit/708fdfcfed70299044a90773d3c9a76c9a139f2f)) by @cgoing-bot

## [1.19.1](https://github.com/cgoinglove/better-chatbot/compare/v1.19.0...v1.19.1) (2025-07-29)

### Bug Fixes

- **agent:** improve agent loading logic and validation handling in EditAgent component [#198](https://github.com/cgoinglove/better-chatbot/issues/198) ([ec034ab](https://github.com/cgoinglove/better-chatbot/commit/ec034ab51dfc656d7378eca1e2b4dc94fbb67863)) by @cgoinglove
- **agent:** update description field to allow nullish values in ChatMentionSchema ([3e4532d](https://github.com/cgoinglove/better-chatbot/commit/3e4532d4c7b561ad03836c743eefb7cd35fe9e74)) by @cgoinglove
- **i18n:** update agent description fields in English, Spanish, and French JSON files to improve clarity and consistency ([f07d1c4](https://github.com/cgoinglove/better-chatbot/commit/f07d1c4dc64b96584faa7e558f981199834a5370)) by @cgoinglove
- Invalid 'tools': array too long. Expected an array with maximum length 128, but got an array with length 217 instead. [#197](https://github.com/cgoinglove/better-chatbot/issues/197) ([b967e3a](https://github.com/cgoinglove/better-chatbot/commit/b967e3a30be3a8a48f3801b916e26ac4d7dd50f4)) by @cgoinglove

## [1.19.0](https://github.com/cgoinglove/better-chatbot/compare/v1.18.0...v1.19.0) (2025-07-28)

### Features

- Add Azure OpenAI provider support with comprehensive testing ([#189](https://github.com/cgoinglove/better-chatbot/issues/189)) ([edad917](https://github.com/cgoinglove/better-chatbot/commit/edad91707d49fcb5d3bd244a77fbaae86527742a)) by @shukyr
- add bot name preference to user settings ([f4aa588](https://github.com/cgoinglove/better-chatbot/commit/f4aa5885d0be06cc21149d09e604c781e551ec4a)) by @cgoinglove
- **agent:** agent and archive ([#192](https://github.com/cgoinglove/better-chatbot/issues/192)) ([c63ae17](https://github.com/cgoinglove/better-chatbot/commit/c63ae179363b66bfa4f4b5524bdf27b71166c299)) by @cgoinglove

### Bug Fixes

- enhance event handling for keyboard shortcuts in chat components ([95dad3b](https://github.com/cgoinglove/better-chatbot/commit/95dad3bd1dac4b6e56be2df35957a849617ba056)) by @cgoinglove
- refine thinking prompt condition in chat API ([0192151](https://github.com/cgoinglove/better-chatbot/commit/0192151fec1e33f3b7bc1f08b0a9582d66650ef0)) by @cgoinglove

## [1.18.0](https://github.com/cgoinglove/better-chatbot/compare/v1.17.1...v1.18.0) (2025-07-24)

### Features

- add sequential thinking tool and enhance UI components ([#183](https://github.com/cgoinglove/better-chatbot/issues/183)) ([5bcbde2](https://github.com/cgoinglove/better-chatbot/commit/5bcbde2de776b17c3cc1f47f4968b13e22fc65b2)) by @cgoinglove

## [1.17.1](https://github.com/cgoinglove/better-chatbot/compare/v1.17.0...v1.17.1) (2025-07-23)

### Bug Fixes

- ensure thread date fallback to current date in AppSidebarThreads component ([800b504](https://github.com/cgoinglove/better-chatbot/commit/800b50498576cfe1717da4385e2a496ac33ea0ad)) by @cgoinglove
- link to the config generator correctly ([#184](https://github.com/cgoinglove/better-chatbot/issues/184)) ([1865ecc](https://github.com/cgoinglove/better-chatbot/commit/1865ecc269e567838bc391a3236fcce82c213fc0)) by @brrock
- python executor ([ea58742](https://github.com/cgoinglove/better-chatbot/commit/ea58742cccd5490844b3139a37171b1b68046f85)) by @cgoinglove

## [1.17.0](https://github.com/cgoinglove/better-chatbot/compare/v1.16.0...v1.17.0) (2025-07-18)

### Features

- add Python execution tool and integrate Pyodide support ([#176](https://github.com/cgoinglove/better-chatbot/issues/176)) ([de2cf7b](https://github.com/cgoinglove/better-chatbot/commit/de2cf7b66444fe64791ed142216277a5f2cdc551)) by @cgoinglove

### Bug Fixes

- generate title by user message ([9ee4be6](https://github.com/cgoinglove/better-chatbot/commit/9ee4be69c6b90f44134d110e90f9c3da5219c79f)) by @cgoinglove
- generate title sync ([5f3afdc](https://github.com/cgoinglove/better-chatbot/commit/5f3afdc4cb7304460606b3480f54f513ef24940c)) by @cgoinglove

## [1.16.0](https://github.com/cgoinglove/better-chatbot/compare/v1.15.0...v1.16.0) (2025-07-15)

### Features

- Lazy Chat Title Generation: Save Empty Title First, Then Generate and Upsert in Parallel ([#162](https://github.com/cgoinglove/better-chatbot/issues/162)) ([31dfd78](https://github.com/cgoinglove/better-chatbot/commit/31dfd7802e33d8d4e91aae321c3d16a07fe42552)) by @cgoinglove
- publish container to GitHub registry ([#149](https://github.com/cgoinglove/better-chatbot/issues/149)) ([9f03cbc](https://github.com/cgoinglove/better-chatbot/commit/9f03cbc1d2890746f14919ebaad60f773b0a333d)) by @codingjoe
- update mention ux ([#161](https://github.com/cgoinglove/better-chatbot/issues/161)) ([7ceb9c6](https://github.com/cgoinglove/better-chatbot/commit/7ceb9c69c32de25d523a4d14623b25a34ffb3c9d)) by @cgoinglove

### Bug Fixes

- bug(LineChart): series are incorrectly represented [#165](https://github.com/cgoinglove/better-chatbot/issues/165) ([4e4905c](https://github.com/cgoinglove/better-chatbot/commit/4e4905c0f7f6a3eca73ea2ac06f718fa29b0f821)) by @cgoinglove
- ignore tool binding on unsupported models (server-side) ([#160](https://github.com/cgoinglove/better-chatbot/issues/160)) ([277b4fe](https://github.com/cgoinglove/better-chatbot/commit/277b4fe986d5b6d9780d9ade83f294d8f34806f6)) by @cgoinglove
- js executor tool and gemini model version ([#169](https://github.com/cgoinglove/better-chatbot/issues/169)) ([e25e10a](https://github.com/cgoinglove/better-chatbot/commit/e25e10ab9fac4247774b0dee7e01d5f6a4b16191)) by @cgoinglove
- **scripts:** parse openai compatible on windows ([#164](https://github.com/cgoinglove/better-chatbot/issues/164)) ([41f5ff5](https://github.com/cgoinglove/better-chatbot/commit/41f5ff55b8d17c76a23a2abf4a6e4cb0c4d95dc5)) by @axel7083
- **workflow-panel:** fix save button width ([#168](https://github.com/cgoinglove/better-chatbot/issues/168)) ([3e66226](https://github.com/cgoinglove/better-chatbot/commit/3e6622630c9cc40ff3d4357e051c45f8c860fc10)) by @axel7083

## [1.15.0](https://github.com/cgoinglove/better-chatbot/compare/v1.14.1...v1.15.0) (2025-07-11)

### Features

- Add js-execution tool and bug fixes(tool call) ([#148](https://github.com/cgoinglove/better-chatbot/issues/148)) ([12b18a1](https://github.com/cgoinglove/better-chatbot/commit/12b18a1cf31a17e565eddc05764b5bd2d0b0edee)) by @cgoinglove

### Bug Fixes

- enhance ToolModeDropdown with tooltip updates and debounce functionality ([d06db0b](https://github.com/cgoinglove/better-chatbot/commit/d06db0b3e1db34dc4785eb31ebd888d7c2ae0d64)) by @cgoinglove

## [1.14.1](https://github.com/cgoinglove/better-chatbot/compare/v1.14.0...v1.14.1) (2025-07-09)

### Bug Fixes

- tool select ui ([#141](https://github.com/cgoinglove/better-chatbot/issues/141)) ([0795524](https://github.com/cgoinglove/better-chatbot/commit/0795524991a7aa3e17990777ca75381e32eaa547)) by @cgoinglove

## [1.14.0](https://github.com/cgoinglove/better-chatbot/compare/v1.13.0...v1.14.0) (2025-07-07)

### Features

- web-search with images ([bea76b3](https://github.com/cgoinglove/better-chatbot/commit/bea76b3a544d4cf5584fa29e5c509b0aee1d4fee)) by @cgoinglove
- **workflow:** add auto layout feature for workflow nodes and update UI messages ([0cfbffd](https://github.com/cgoinglove/better-chatbot/commit/0cfbffd631c9ae5c6ed57d47ca5f34b9acbb257d)) by @cgoinglove
- **workflow:** stable workflow ( add example workflow : baby-research ) ([#137](https://github.com/cgoinglove/better-chatbot/issues/137)) ([c38a7ea](https://github.com/cgoinglove/better-chatbot/commit/c38a7ea748cdb117a4d0f4b886e3d8257a135956)) by @cgoinglove

### Bug Fixes

- **api:** handle error case in chat route by using orElse for unwrap ([25580a2](https://github.com/cgoinglove/better-chatbot/commit/25580a2a9f6c9fbc4abc29fee362dc4b4f27f9b4)) by @cgoinglove
- **workflow:** llm structure Output ([c529292](https://github.com/cgoinglove/better-chatbot/commit/c529292ddc1a4b836a5921e25103598afd7e3ab7)) by @cgoinglove

## [1.13.0](https://github.com/cgoinglove/better-chatbot/compare/v1.12.1...v1.13.0) (2025-07-04)

### Features

- Add web search and content extraction tools using Tavily API ([#126](https://github.com/cgoinglove/better-chatbot/issues/126)) ([f7b4ea5](https://github.com/cgoinglove/better-chatbot/commit/f7b4ea5828b33756a83dd881b9afa825796bf69f)) by @cgoing-bot

### Bug Fixes

- workflow condition node issue ([78b7add](https://github.com/cgoinglove/better-chatbot/commit/78b7addbba51b4553ec5d0ce8961bf90be5d649c)) by @cgoinglove
- **workflow:** improve mention handling by ensuring empty values are represented correctly ([92ff9c3](https://github.com/cgoinglove/better-chatbot/commit/92ff9c3e14b97d9f58a22f9df2559e479f14537c)) by @cgoinglove
- **workflow:** simplify mention formatting by removing bold styling for non-empty values ([ef65fd7](https://github.com/cgoinglove/better-chatbot/commit/ef65fd713ab59c7d8464cae480df7626daeff5cd)) by @cgoinglove

## [1.12.1](https://github.com/cgoinglove/better-chatbot/compare/v1.12.0...v1.12.1) (2025-07-02)

### Bug Fixes

- **workflow:** enhance structured output handling and improve user notifications ([dd43de9](https://github.com/cgoinglove/better-chatbot/commit/dd43de99881d64ca0c557e29033e953bcd4adc0e)) by @cgoinglove

## [1.12.0](https://github.com/cgoinglove/better-chatbot/compare/v1.11.0...v1.12.0) (2025-07-01)

### Features

- **chat:** enable [@mention](https://github.com/mention) and tool click to trigger workflow execution in chat ([#122](https://github.com/cgoinglove/better-chatbot/issues/122)) ([b4e7f02](https://github.com/cgoinglove/better-chatbot/commit/b4e7f022fa155ef70be2aee9228a4d1d2643bf10)) by @cgoing-bot

### Bug Fixes

- clean changlelog and stop duplicate attributions in the changelog file ([#119](https://github.com/cgoinglove/better-chatbot/issues/119)) ([aa970b6](https://github.com/cgoinglove/better-chatbot/commit/aa970b6a2d39ac1f0ca22db761dd452e3c7a5542)) by @brrock

## [1.11.0](https://github.com/cgoinglove/better-chatbot/compare/v1.10.0...v1.11.0) (2025-06-28)

### Features

- **workflow:** Add HTTP and Template nodes with LLM structured output supportWorkflow node ([#117](https://github.com/cgoinglove/better-chatbot/issues/117)) ([10ec438](https://github.com/cgoinglove/better-chatbot/commit/10ec438f13849f0745e7fab652cdd7cef8e97ab6)) by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot
- **workflow:** add HTTP node configuration and execution support ([7d2f65f](https://github.com/cgoinglove/better-chatbot/commit/7d2f65fe4f0fdaae58ca2a69abb04abee3111c60)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove

### Bug Fixes

- add POST endpoint for MCP client saving with session validation ([fa005aa](https://github.com/cgoinglove/better-chatbot/commit/fa005aaecbf1f8d9279f5b4ce5ba85343e18202b)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove
- split theme system into base themes and style variants ([61ebd07](https://github.com/cgoinglove/better-chatbot/commit/61ebd0745bcfd7a84ba3ad65c3f52b7050b5131a)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove
- update ToolMessagePart to use isExecuting state instead of isExpanded ([752f8f0](https://github.com/cgoinglove/better-chatbot/commit/752f8f06e319119569e9ee7c04d621ab1c43ca54)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove

## [1.10.0](https://github.com/cgoinglove/better-chatbot/compare/v1.9.0...v1.10.0) (2025-06-27)

### Features

- **releases:** add debug logging to the add authors and update release step ([#105](https://github.com/cgoinglove/better-chatbot/issues/105)) ([c855a6a](https://github.com/cgoinglove/better-chatbot/commit/c855a6a94c49dfd93c9a8d1d0932aeda36bd6c7e)) by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock
- workflow beta ([#100](https://github.com/cgoinglove/better-chatbot/issues/100)) ([2f5ada2](https://github.com/cgoinglove/better-chatbot/commit/2f5ada2a66e8e3cd249094be9d28983e4331d3a1)) by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot

### Bug Fixes

- update tool selection logic in McpServerSelector to maintain current selections ([4103c1b](https://github.com/cgoinglove/better-chatbot/commit/4103c1b828c3e5b513679a3fb9d72bd37301f99d)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove
- **workflow:** MPC Tool Response Structure And Workflow ([#113](https://github.com/cgoinglove/better-chatbot/issues/113)) ([836ffd7](https://github.com/cgoinglove/better-chatbot/commit/836ffd7ef5858210bdce44d18ca82a1c8f0fc87f)) by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot

## [1.9.0](https://github.com/cgoinglove/better-chatbot/compare/v1.8.0...v1.9.0) (2025-06-16)

### Features

- credit contributors in releases and changlogs ([#104](https://github.com/cgoinglove/better-chatbot/issues/104)) ([e0e4443](https://github.com/cgoinglove/better-chatbot/commit/e0e444382209a36f03b6e898f26ebd805032c306)) by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock

### Bug Fixes

- increase maxTokens for title generation in chat actions issue [#102](https://github.com/cgoinglove/better-chatbot/issues/102) ([bea2588](https://github.com/cgoinglove/better-chatbot/commit/bea2588e24cf649133e8ce5f3b6391265b604f06)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove
- temporary chat initial model ([0393f7a](https://github.com/cgoinglove/better-chatbot/commit/0393f7a190463faf58cbfbca1c21d349a9ff05dc)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove
- update adding-openAI-like-providers.md ([#101](https://github.com/cgoinglove/better-chatbot/issues/101)) ([2bb94e7](https://github.com/cgoinglove/better-chatbot/commit/2bb94e7df63a105e33c1d51271751c7b89fead23)) by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock
- update config file path in release workflow ([7209cbe](https://github.com/cgoinglove/better-chatbot/commit/7209cbeb89bd65b14aee66a40ed1abb5c5f2e018)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove

## [1.8.0](https://github.com/cgoinglove/better-chatbot/compare/v1.7.0...v1.8.0) (2025-06-11)

### Features

- add openAI compatible provider support ([#92](https://github.com/cgoinglove/better-chatbot/issues/92)) ([6682c9a](https://github.com/cgoinglove/better-chatbot/commit/6682c9a320aff9d91912489661d27ae9bb0f4440)) by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock by @brrock

### Bug Fixes

- Enhance component styles and configurations ([a7284f1](https://github.com/cgoinglove/better-chatbot/commit/a7284f12ca02ee29f7da4d57e4fe6e8c6ecb2dfc)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove

## [1.7.0](https://github.com/cgoinglove/better-chatbot/compare/v1.6.2...v1.7.0) (2025-06-06)

### Features

- Per User Custom instructions ([#86](https://github.com/cgoinglove/better-chatbot/issues/86)) ([d45c968](https://github.com/cgoinglove/better-chatbot/commit/d45c9684adfb0d9b163c83f3bb63310eef572279)) by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu by @vineetu

## [1.6.2](https://github.com/cgoinglove/better-chatbot/compare/v1.6.1...v1.6.2) (2025-06-04)

### Bug Fixes

- enhance error handling in chat bot component ([1519799](https://github.com/cgoinglove/better-chatbot/commit/15197996ba1f175db002b06e3eac2765cfae1518)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove
- improve session error handling in authentication ([eb15b55](https://github.com/cgoinglove/better-chatbot/commit/eb15b550facf5368f990d58b4b521bf15aecbf72)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove
- support OpenAI real-time chat project instructions ([2ebbb5e](https://github.com/cgoinglove/better-chatbot/commit/2ebbb5e68105ef6706340a6cfbcf10b4d481274a)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove
- unify SSE and streamable config as RemoteConfig ([#85](https://github.com/cgoinglove/better-chatbot/issues/85)) ([66524a0](https://github.com/cgoinglove/better-chatbot/commit/66524a0398bd49230fcdec73130f1eb574e97477)) by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot

## [1.6.1](https://github.com/cgoinglove/better-chatbot/compare/v1.6.0...v1.6.1) (2025-06-02)

### Bug Fixes

- speech ux ([baa849f](https://github.com/cgoinglove/better-chatbot/commit/baa849ff2b6b147ec685c6847834385652fc3191)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove

## [1.6.0](https://github.com/cgoinglove/better-chatbot/compare/v1.5.2...v1.6.0) (2025-06-01)

### Features

- add husky for formatting and checking commits ([#71](https://github.com/cgoinglove/better-chatbot/issues/71)) ([a379cd3](https://github.com/cgoinglove/better-chatbot/commit/a379cd3e869b5caab5bcaf3b03f5607021f988ef)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove
- add Spanish, French, Japanese, and Chinese language support with UI improvements ([#74](https://github.com/cgoinglove/better-chatbot/issues/74)) ([e34d43d](https://github.com/cgoinglove/better-chatbot/commit/e34d43df78767518f0379a434f8ffb1808b17e17)) by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot
- implement cold start-like auto connection for MCP server and simplify status ([#73](https://github.com/cgoinglove/better-chatbot/issues/73)) ([987c442](https://github.com/cgoinglove/better-chatbot/commit/987c4425504d6772e0aefe08b4e1911e4cb285c1)) by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot by @cgoing-bot

## [1.5.2](https://github.com/cgoinglove/better-chatbot/compare/v1.5.1...v1.5.2) (2025-06-01)

### Features

- Add support for Streamable HTTP Transport [#56](https://github.com/cgoinglove/better-chatbot/issues/56) ([8783943](https://github.com/cgoinglove/better-chatbot/commit/878394337e3b490ec2d17bcc302f38c695108d73)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove
- implement speech system prompt and update voice chat options for enhanced user interaction ([5a33626](https://github.com/cgoinglove/better-chatbot/commit/5a336260899ab542407c3c26925a147c1a9bba11)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove
- update MCP server UI and translations for improved user experience ([1e2fd31](https://github.com/cgoinglove/better-chatbot/commit/1e2fd31f8804669fbcf55a4c54ccf0194a7e797c)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove

### Bug Fixes

- enhance mobile UI experience with responsive design adjustments ([2eee8ba](https://github.com/cgoinglove/better-chatbot/commit/2eee8bab078207841f4d30ce7708885c7268302e)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove
- UI improvements for mobile experience ([#66](https://github.com/cgoinglove/better-chatbot/issues/66)) ([b4349ab](https://github.com/cgoinglove/better-chatbot/commit/b4349abf75de69f65a44735de2e0988c6d9d42d8)) by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove by @cgoinglove

### Miscellaneous Chores

- release 1.5.2 ([d185514](https://github.com/cgoinglove/better-chatbot/commit/d1855148cfa53ea99c9639f8856d0e7c58eca020)) by @cgoinglove
