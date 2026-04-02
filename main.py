from pathlib import Path
from time import perf_counter

from docling.document_converter import DocumentConverter

# document per local path or URL
source = "/Users/dwickyferiansyahputra/Public/Research/chat-enterprise/better-chatbot/docs/example/BBCA_Q4_2025.pdf"
output_path = Path(source).with_suffix(".md")

converter = DocumentConverter()
start_time = perf_counter()
result = converter.convert(source)
duration_seconds = perf_counter() - start_time

markdown_content = result.document.export_to_markdown()
markdown_with_duration = (
    f"> Conversion duration: {duration_seconds:.2f} seconds\n\n"
    f"{markdown_content}"
)

output_path.write_text(markdown_with_duration, encoding="utf-8")
