package util

import (
	"fmt"
	"regexp"
	"strconv"
	"time"
)

var relativePattern = regexp.MustCompile(`^\+(\d+)([hmd])$`)

// ParseDeadline parses a deadline string and returns a unix timestamp.
// Accepted formats: +1h, +30m, +7d, ISO 8601, unix timestamp.
func ParseDeadline(input string) (int64, error) {
	// Relative format: +1h, +30m, +7d
	if m := relativePattern.FindStringSubmatch(input); m != nil {
		value, _ := strconv.Atoi(m[1])
		unit := m[2]
		multipliers := map[string]int{"m": 60, "h": 3600, "d": 86400}
		return time.Now().Unix() + int64(value)*int64(multipliers[unit]), nil
	}

	// Unix timestamp
	if ts, err := strconv.ParseInt(input, 10, 64); err == nil && ts > 1_000_000_000 {
		return ts, nil
	}

	// ISO 8601
	for _, layout := range []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	} {
		if t, err := time.Parse(layout, input); err == nil {
			return t.Unix(), nil
		}
	}

	return 0, fmt.Errorf("invalid deadline format: %q. Use +1h, +30m, +7d, ISO 8601, or unix timestamp", input)
}
