from docling.document_converter import DocumentConverter

source = "/Users/dwickyferiansyahputra/Public/Research/chat-enterprise/better-chatbot/docs/example/BBCA_Q4_2025.pdf"  # document per local path or URL
converter = DocumentConverter()
result = converter.convert(source)
print(result.document.export_to_markdown())  # output: "## Docling Technical Report[...]"