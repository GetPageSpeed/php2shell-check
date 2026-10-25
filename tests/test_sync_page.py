"""Exercise the owned checker-page extraction adapter without network requests."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('extract_rules', Path(__file__).resolve().parent.parent / 'tools/extract-rules.py')
extract_rules = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract_rules)


class PageExtractionTests(unittest.TestCase):
    def test_script_attribute_order_does_not_change_source_identity(self):
        """Read both the current WordPress output and its alternate ordering."""
        for script in ('<script id="gps-php2shell-js" src="/checker.js"></script>',
                       '<script src="/checker.js" id="gps-php2shell-js" defer></script>'):
            with self.subTest(script=script):
                page = '<script type="application/json" id="gps-p2s-data">{"updated":"today"}</script>' + script
                data, url = extract_rules.extract(page, 'https://example.test/php2shell')
                self.assertEqual(data, {'updated': 'today'})
                self.assertEqual(url, 'https://example.test/checker.js')

    def test_unquoted_attributes_and_query_entities(self):
        """Read valid HTML attributes and resolve a relative evaluator URL."""
        page = '<script id=gps-p2s-data type=application/json>{"rules":[]}</script><script src="checker.js?a=1&amp;b=2" id=gps-php2shell-js></script>'
        data, url = extract_rules.extract(page, 'https://example.test/tool/')
        self.assertEqual(data, {'rules': []})
        self.assertEqual(url, 'https://example.test/tool/checker.js?a=1&b=2')

    def test_missing_or_ambiguous_checker_inputs_fail(self):
        """Reject incomplete or duplicate source declarations before writing."""
        for page in ('<script src="other.js"></script>',
                     '<script type="application/json" id="gps-p2s-data">{}</script><script id="gps-php2shell-js" src="one.js"></script><script id="gps-php2shell-js" src="two.js"></script>'):
            with self.subTest(page=page), self.assertRaises(ValueError):
                extract_rules.extract(page, 'https://example.test/')


if __name__ == '__main__':
    unittest.main()
