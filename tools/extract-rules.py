#!/usr/bin/env python3
"""Extract checker data and its evaluator URL from the canonical HTML page."""
from html.parser import HTMLParser
import json
from pathlib import Path
import sys
from urllib.parse import urljoin


class CheckerPage(HTMLParser):
    """Collect the two named checker inputs regardless of attribute order."""
    def __init__(self):
        super().__init__()
        self.collecting = False
        self.data_count = 0
        self.data_chunks = []
        self.script_urls = []

    def handle_starttag(self, tag, attrs):
        """Select the named data and evaluator script elements."""
        if tag != 'script':
            return
        values = dict(attrs)
        self.collecting = values.get('id') == 'gps-p2s-data' and values.get('type') == 'application/json'
        if self.collecting:
            self.data_count += 1
        if values.get('id') == 'gps-php2shell-js' and values.get('src'):
            self.script_urls.append(values['src'])

    def handle_data(self, data):
        """Retain the JSON script body without modifying it."""
        if self.collecting:
            self.data_chunks.append(data)

    def handle_endtag(self, tag):
        """Finish the current script body."""
        if tag == 'script':
            self.collecting = False


def extract(page, base_url):
    """Extract exactly one rules object and evaluator location.

    Args:
        page (str): Checker page HTML.
        base_url (str): URL used to retrieve that page.

    Returns:
        tuple: Parsed data dictionary and absolute evaluator URL.

    Raises:
        ValueError: Required page inputs are missing, ambiguous or invalid.
    """
    parser = CheckerPage()
    parser.feed(page)
    parser.close()
    if parser.data_count != 1 or len(parser.script_urls) != 1:
        raise ValueError('expected exactly one rules data block and checker script')
    return json.loads(''.join(parser.data_chunks)), urljoin(base_url, parser.script_urls[0])


if __name__ == '__main__':
    try:
        data, script_url = extract(Path(sys.argv[1]).read_text(), sys.argv[3])
        Path(sys.argv[2]).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
        print(script_url)
    except (ValueError, OSError) as error:
        raise SystemExit(str(error)) from error
