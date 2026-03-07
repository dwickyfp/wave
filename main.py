from collections.abc import Iterable
import unittest


def algorithma(numbers):
    """Return the sum of squared numeric values from an iterable.

    Example:
        algorithma([1, 2, 3]) -> 14
    """
    if not isinstance(numbers, Iterable) or isinstance(numbers, (str, bytes)):
        raise TypeError("numbers must be a non-string iterable")

    total = 0
    for value in numbers:
        if not isinstance(value, (int, float)):
            raise TypeError("all items must be numeric")
        total += value * value
    return total


class TestAlgorithma(unittest.TestCase):
    def test_returns_sum_of_squares(self):
        self.assertEqual(algorithma([1, 2, 3]), 14)

    def test_returns_zero_for_empty_iterable(self):
        self.assertEqual(algorithma([]), 0)

    def test_raises_for_non_iterable_input(self):
        with self.assertRaises(TypeError):
            algorithma(123)

    def test_raises_for_non_numeric_item(self):
        with self.assertRaises(TypeError):
            algorithma([1, "two", 3])


if __name__ == "__main__":
    unittest.main()
