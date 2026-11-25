import pypdfium2 as pdfium

def extract_text_from_pdf(pdf_path: str) -> str:
    pdf = pdfium.PdfDocument(pdf_path)
    text_parts = []
    for page in pdf:
        textpage = page.get_textpage()
        text_parts.append(textpage.get_text_bounded())
    return "\n".join(text_parts)

