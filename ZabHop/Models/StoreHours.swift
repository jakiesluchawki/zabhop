import Foundation

enum StoreAvailability: String, CaseIterable, Identifiable, Sendable {
    case openNow
    case planning

    var id: String { rawValue }

    var buttonTitle: String {
        switch self {
        case .openNow: "Otwarte teraz"
        case .planning: "Na później"
        }
    }
}

enum StoreOpenState: String, Sendable {
    case open
    case probablyOpen
    case closed
    case unknown
}

struct StoreOpeningTransition: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case opening
        case closing
    }

    let kind: Kind
    let minutesRemaining: Int

    var label: String {
        switch kind {
        case .opening: "Otwiera się za \(minutesRemaining) min"
        case .closing: "Zamyka się za \(minutesRemaining) min"
        }
    }

    var badge: String {
        switch kind {
        case .opening: "OTWIERA ZA \(minutesRemaining) MIN"
        case .closing: "ZAMYKA ZA \(minutesRemaining) MIN"
        }
    }
}

struct StoreOpenStatus: Equatable, Sendable {
    let state: StoreOpenState
    let label: String
    let badge: String
    let transition: StoreOpeningTransition?

    init(
        state: StoreOpenState,
        label: String,
        badge: String,
        transition: StoreOpeningTransition? = nil
    ) {
        self.state = state
        self.label = label
        self.badge = badge
        self.transition = transition
    }

    static let unknown = StoreOpenStatus(
        state: .unknown,
        label: "Godziny niepotwierdzone",
        badge: "NIEPOTWIERDZONE"
    )

    static let probablyOpen = StoreOpenStatus(
        state: .probablyOpen,
        label: "Prawdopodobnie otwarte · brak godzin",
        badge: "PRAWDOPODOBNIE"
    )
}

enum StoreOpeningPolicy {
    // A deliberately narrower fallback than the common 06:00–23:00 Żabka
    // schedule. It makes an unknown daytime shop useful without pretending
    // that unverified late-night hours are factual.
    static let probableZabkaStartMinute = 7 * 60
    static let probableZabkaEndMinute = 21 * 60
    static let probableZabkaDistancePenalty = 350.0
    static let unknownOtherStoreDistancePenalty = 500.0
    static let closingBeforeArrivalDistancePenalty = 1_400.0

    static func assessedStatus(
        confirmedStatus: StoreOpenStatus,
        mode: StoreMode,
        availability: StoreAvailability,
        at date: Date
    ) -> StoreOpenStatus {
        assessedStatus(
            confirmedStatus: confirmedStatus,
            mode: mode,
            availability: availability,
            at: StoreHours.evaluationMoment(at: date)
        )
    }

    static func assessedStatus(
        confirmedStatus: StoreOpenStatus,
        mode: StoreMode,
        availability: StoreAvailability,
        at moment: StoreHours.EvaluationMoment?
    ) -> StoreOpenStatus {
        guard availability == .openNow,
              mode == .zabka,
              confirmedStatus.state == .unknown,
              let moment,
              !moment.isPolishPublicHoliday,
              moment.currentMinute >= Double(probableZabkaStartMinute),
              moment.currentMinute < Double(probableZabkaEndMinute) else {
            return confirmedStatus
        }
        return .probablyOpen
    }

    static func isOpenNowCandidate(
        _ status: StoreOpenStatus,
        mode: StoreMode = .zabka
    ) -> Bool {
        status.state == .open
            || status.state == .probablyOpen
            || (mode == .other && status.state == .unknown)
    }

    static func rankingScore(
        distance: Double,
        assessedStatus: StoreOpenStatus,
        availability: StoreAvailability
    ) -> Double {
        guard availability == .openNow else {
            return distance
        }

        switch assessedStatus.state {
        case .probablyOpen:
            return distance + probableZabkaDistancePenalty
        case .unknown:
            return distance + unknownOtherStoreDistancePenalty
        case .open:
            guard let transition = assessedStatus.transition,
                  transition.kind == .closing,
                  distance >= 35 else {
                return distance
            }

            let estimatedWalkingMinutes = Int(
                (GeoMath.estimatedWalkingDuration(for: distance) / 60).rounded(.up)
            )
            return transition.minutesRemaining <= estimatedWalkingMinutes
                ? distance + closingBeforeArrivalDistancePenalty
                : distance
        case .closed:
            return distance
        }
    }
}

struct StoreHours: Hashable, Sendable {
    static let closingSoonThresholdMinutes = 45
    static let openingSoonThresholdMinutes = 60

    struct EvaluationMoment: Sendable {
        let dayIndex: Int
        let currentMinute: Double
        let isPolishPublicHoliday: Bool
    }

    let days: [String?]

    init?(_ days: [String?]) {
        guard days.count == 7,
              days.allSatisfy({ value in
                  value == nil || StoreHours.decodeIntervals(value!) != nil
              }) else { return nil }
        self.days = days
    }

    func status(at date: Date = Date(), holidaysClosed: Bool = false) -> StoreOpenStatus {
        guard let moment = StoreHours.evaluationMoment(at: date) else { return .unknown }
        return status(at: moment, holidaysClosed: holidaysClosed)
    }

    func status(at moment: EvaluationMoment, holidaysClosed: Bool = false) -> StoreOpenStatus {
        if holidaysClosed && moment.isPolishPublicHoliday {
            return StoreOpenStatus(
                state: .closed,
                label: "Zamknięte — dzień świąteczny",
                badge: "ZAMKNIĘTE"
            )
        }

        guard let encoded = days[moment.dayIndex] else {
            return StoreOpenStatus(
                state: .unknown,
                label: "Godziny niepotwierdzone",
                badge: "NIEPOTWIERDZONE"
            )
        }
        guard let intervals = StoreHours.decodeIntervals(encoded) else { return .unknown }

        if let current = intervals.first(where: {
            moment.currentMinute >= Double($0.start) && moment.currentMinute < Double($0.end)
        }) {
            let minutesRemaining = minutesUntilClosing(current: current, at: moment)
            let transition: StoreOpeningTransition? = if minutesRemaining <= Self.closingSoonThresholdMinutes {
                StoreOpeningTransition(kind: .closing, minutesRemaining: minutesRemaining)
            } else {
                nil
            }

            return StoreOpenStatus(
                state: .open,
                label: transition?.label
                    ?? (current.start == 0 && current.end == 1_440
                        ? "Otwarte teraz"
                        : "Otwarte do \(StoreHours.format(minutes: current.end))"),
                badge: transition?.badge ?? "OTWARTE",
                transition: transition
            )
        }

        let openingTransition: StoreOpeningTransition? = minutesUntilOpening(intervals: intervals, at: moment).flatMap { minutes in
            guard minutes <= Self.openingSoonThresholdMinutes else { return nil }
            return StoreOpeningTransition(kind: .opening, minutesRemaining: minutes)
        }

        return StoreOpenStatus(
            state: .closed,
            label: openingTransition?.label ?? "Zamknięte teraz",
            badge: openingTransition?.badge ?? "ZAMKNIĘTE",
            transition: openingTransition
        )
    }

    private func minutesUntilClosing(current: Interval, at moment: EvaluationMoment) -> Int {
        var remaining = Double(current.end) - moment.currentMinute
        var dayIndex = moment.dayIndex
        var end = current.end

        for _ in 0..<7 where end == 1_440 {
            dayIndex = (dayIndex + 1) % 7
            guard let encoded = days[dayIndex],
                  let continuation = Self.decodeIntervals(encoded)?.first,
                  continuation.start == 0 else {
                break
            }
            remaining += Double(continuation.end)
            end = continuation.end
        }

        return max(1, Int(remaining.rounded(.up)))
    }

    private func minutesUntilOpening(intervals: [Interval], at moment: EvaluationMoment) -> Int? {
        if let next = intervals.first(where: { Double($0.start) > moment.currentMinute }) {
            return max(1, Int((Double(next.start) - moment.currentMinute).rounded(.up)))
        }

        let nextDayIndex = (moment.dayIndex + 1) % 7
        guard let encoded = days[nextDayIndex],
              let first = Self.decodeIntervals(encoded)?.first else {
            return nil
        }

        let remaining = Double(1_440 + first.start) - moment.currentMinute
        return max(1, Int(remaining.rounded(.up)))
    }

    static func evaluationMoment(at date: Date) -> EvaluationMoment? {
        let parts = StoreHours.warsawCalendar.dateComponents(
            [.year, .month, .day, .weekday, .hour, .minute, .second],
            from: date
        )
        guard let year = parts.year,
              let month = parts.month,
              let day = parts.day,
              let weekday = parts.weekday,
              let hour = parts.hour,
              let minute = parts.minute else { return nil }
        let dayIndex = (weekday + 5) % 7 // Foundation: Sunday = 1; catalog: Monday = 0.
        let currentMinute = Double(hour * 60 + minute) + Double(parts.second ?? 0) / 60
        return EvaluationMoment(
            dayIndex: dayIndex,
            currentMinute: currentMinute,
            isPolishPublicHoliday: isPolishPublicHoliday(year: year, month: month, day: day)
        )
    }

    static func isPolishPublicHoliday(year: Int, month: Int, day: Int) -> Bool {
        let fixed: Set<MonthDay> = [
            .init(month: 1, day: 1), .init(month: 1, day: 6),
            .init(month: 5, day: 1), .init(month: 5, day: 3),
            .init(month: 8, day: 15), .init(month: 11, day: 1),
            .init(month: 11, day: 11), .init(month: 12, day: 24),
            .init(month: 12, day: 25), .init(month: 12, day: 26)
        ]
        let candidate = MonthDay(month: month, day: day)
        if fixed.contains(candidate) { return true }

        let easter = easterSunday(year: year)
        return [0, 1, 49, 60].contains { offset in
            guard let shifted = utcCalendar.date(byAdding: .day, value: offset, to: easter) else {
                return false
            }
            let parts = utcCalendar.dateComponents([.month, .day], from: shifted)
            return parts.month == month && parts.day == day
        }
    }

    fileprivate struct Interval: Equatable {
        let start: Int
        let end: Int
    }

    fileprivate static func decodeIntervals(_ value: String) -> [Interval]? {
        if value.isEmpty { return [] }

        var intervals: [Interval] = []
        for part in value.split(separator: ",", omittingEmptySubsequences: false) {
            let bounds = part.split(separator: "-", omittingEmptySubsequences: false)
            guard bounds.count == 2,
                  let start = Int(bounds[0]),
                  let end = Int(bounds[1]),
                  start >= 0,
                  end <= 1_440,
                  end > start else { return nil }
            intervals.append(Interval(start: start, end: end))
        }
        return intervals
    }

    fileprivate static func encodeIntervals(_ intervals: [Interval]) -> String {
        let sorted = intervals
            .filter { $0.end > $0.start }
            .sorted { lhs, rhs in
                lhs.start == rhs.start ? lhs.end < rhs.end : lhs.start < rhs.start
            }
        var merged: [Interval] = []
        for interval in sorted {
            if let previous = merged.last, interval.start <= previous.end {
                merged[merged.count - 1] = Interval(
                    start: previous.start,
                    end: max(previous.end, interval.end)
                )
            } else {
                merged.append(interval)
            }
        }
        return merged.map { "\($0.start)-\($0.end)" }.joined(separator: ",")
    }

    private static let warsawCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Warsaw") ?? .gmt
        return calendar
    }()

    private static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar
    }()

    private static func easterSunday(year: Int) -> Date {
        let a = year % 19
        let b = year / 100
        let c = year % 100
        let d = b / 4
        let e = b % 4
        let f = (b + 8) / 25
        let g = (b - f + 1) / 3
        let h = (19 * a + b - d - g + 15) % 30
        let i = c / 4
        let k = c % 4
        let l = (32 + 2 * e + 2 * i - h - k) % 7
        let m = (a + 11 * h + 22 * l) / 451
        let month = (h + l - 7 * m + 114) / 31
        let day = ((h + l - 7 * m + 114) % 31) + 1
        return utcCalendar.date(from: DateComponents(year: year, month: month, day: day))!
    }

    private static func format(minutes: Int) -> String {
        String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }
}

enum OfficialOpeningHoursValue: Equatable {
    case hours(String)
    case closed
}

enum StoreHoursParser {
    struct ParsedOSMHours: Equatable {
        let hours: StoreHours
        let holidaysClosed: Bool
    }

    static func normalizeOfficial(_ openingHours: [String: OfficialOpeningHoursValue]) -> StoreHours? {
        let selectors: [String: [Int]] = [
            "mon-sat": [0, 1, 2, 3, 4, 5],
            "sun": [6],
            "mon-sun": [0, 1, 2, 3, 4, 5, 6]
        ]
        var intervals: [[StoreHours.Interval]] = Array(repeating: [], count: 7)
        var knownDays = Array(repeating: false, count: 7)

        guard openingHours.keys.allSatisfy({ selectors[$0] != nil }) else { return nil }
        // A specific Sunday rule overrides a broad weekday rule, including
        // Saturday's overnight spill into Sunday.
        for selector in ["mon-sun", "mon-sat", "sun"] {
            guard let value = openingHours[selector], let indices = selectors[selector] else {
                continue
            }
            for day in Set(indices) {
                intervals[day] = []
                knownDays[day] = true
            }
            switch value {
            case .closed:
                continue
            case .hours(let text):
                guard let range = parseTimeRange(text, midnightMeansAllDay: false) else { return nil }
                // The official feed's 00:00-00:00 sentinel is not reliable
                // evidence of 24-hour opening. Keep selected days unknown.
                if range.start == range.end {
                    for day in Set(indices) {
                        intervals[day] = []
                        knownDays[day] = false
                    }
                    continue
                }
                for day in indices {
                    if range.end > range.start {
                        intervals[day].append(range)
                    } else if range.end < range.start {
                        intervals[day].append(.init(start: range.start, end: 1_440))
                        let nextDay = (day + 1) % 7
                        knownDays[nextDay] = true
                        intervals[nextDay].append(.init(start: 0, end: range.end))
                    }
                }
            }
        }

        let days: [String?] = zip(knownDays, intervals).map { known, values in
            known ? StoreHours.encodeIntervals(values) : nil
        }
        guard days.contains(where: { $0 != nil }) else { return nil }
        return StoreHours(days)
    }

    static func parseOSM(_ expression: String?) -> ParsedOSMHours? {
        let raw = expression?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !raw.isEmpty else { return nil }
        if raw == "24/7" {
            return StoreHours(Array(repeating: "0-1440", count: 7)).map {
                ParsedOSMHours(hours: $0, holidaysClosed: false)
            }
        }

        let forbiddenTokens = [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
            "week", "easter", "sunrise", "sunset", "unknown"
        ]
        guard !forbiddenTokens.contains(where: { containsWord(raw, word: $0) }),
              !raw.contains("\"") && !raw.contains("[") && !raw.contains("]") &&
              !raw.contains("|") && !raw.contains("+") else { return nil }

        var days: [[StoreHours.Interval]] = Array(repeating: [], count: 7)
        var touchedWeekday = false
        var holidaysClosed = false

        for rawRule in raw.split(separator: ";", omittingEmptySubsequences: true) {
            let rule = rawRule
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: #",\s+"#, with: ",", options: .regularExpression)
            guard let separator = rule.firstIndex(where: { $0.isWhitespace }) else { return nil }
            let selectorText = String(rule[..<separator])
            let scheduleText = rule[separator...]
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: #"\s+open$"#, with: "", options: .regularExpression)

            var selectedDays: [Int] = []
            var includesHoliday = false
            for rawSelector in selectorText.split(separator: ",", omittingEmptySubsequences: false) {
                let selector = rawSelector.trimmingCharacters(in: .whitespacesAndNewlines)
                if selector == "PH" {
                    includesHoliday = true
                } else if let expanded = expandDaySelector(selector) {
                    selectedDays.append(contentsOf: expanded)
                } else {
                    return nil
                }
            }

            if scheduleText.caseInsensitiveCompare("off") == .orderedSame ||
                scheduleText.caseInsensitiveCompare("closed") == .orderedSame {
                if includesHoliday { holidaysClosed = true }
                for day in Set(selectedDays) {
                    days[day] = []
                    touchedWeekday = true
                }
                continue
            }
            guard !includesHoliday else { return nil }

            let ranges = scheduleText.split(separator: ",", omittingEmptySubsequences: false)
                .map { parseTimeRange(String($0), midnightMeansAllDay: false) }
            guard !ranges.isEmpty, !ranges.contains(where: { $0 == nil }) else { return nil }

            let uniqueDays = Set(selectedDays)
            // In opening_hours, a later rule for the same weekday overrides the
            // earlier rule, including an overnight spill from the previous day.
            // Clear every selected day first so a multi-day overnight rule can
            // then rebuild all of its own spills without erasing them mid-rule.
            for day in uniqueDays {
                days[day] = []
            }
            for day in uniqueDays {
                for range in ranges.compactMap({ $0 }) {
                    add(range: range, to: day, days: &days)
                }
                touchedWeekday = true
            }
        }

        guard touchedWeekday,
              let hours = StoreHours(days.map(StoreHours.encodeIntervals)) else { return nil }
        return ParsedOSMHours(hours: hours, holidaysClosed: holidaysClosed)
    }

    private static let dayIndices = [
        "Mo": 0, "Tu": 1, "We": 2, "Th": 3, "Fr": 4, "Sa": 5, "Su": 6
    ]

    private static func expandDaySelector(_ selector: String) -> [Int]? {
        if let day = dayIndices[selector] { return [day] }
        let bounds = selector.split(separator: "-", omittingEmptySubsequences: false)
        guard bounds.count == 2,
              let start = dayIndices[String(bounds[0])],
              let end = dayIndices[String(bounds[1])] else { return nil }
        var result: [Int] = []
        var cursor = start
        for _ in 0..<7 {
            result.append(cursor)
            if cursor == end { return result }
            cursor = (cursor + 1) % 7
        }
        return nil
    }

    private static func parseTimeRange(
        _ value: String,
        midnightMeansAllDay: Bool
    ) -> StoreHours.Interval? {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let bounds = text.components(separatedBy: "-")
        guard bounds.count == 2,
              let start = parseClock(bounds[0]),
              let rawEnd = parseClock(bounds[1]) else { return nil }
        if midnightMeansAllDay && start == 0 && rawEnd == 0 {
            return .init(start: 0, end: 1_440)
        }
        return .init(start: start, end: rawEnd)
    }

    private static func parseClock(_ value: String) -> Int? {
        let parts = value.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ":")
        guard parts.count == 2 || parts.count == 3,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]),
              hour >= 0,
              hour <= 24,
              minute >= 0,
              minute <= 59,
              !(hour == 24 && minute != 0) else { return nil }
        return hour * 60 + minute
    }

    private static func add(
        range: StoreHours.Interval,
        to day: Int,
        days: inout [[StoreHours.Interval]]
    ) {
        guard range.start != range.end else { return }
        if range.end > range.start {
            days[day].append(range)
        } else {
            days[day].append(.init(start: range.start, end: 1_440))
            days[(day + 1) % 7].append(.init(start: 0, end: range.end))
        }
    }

    private static func containsWord(_ text: String, word: String) -> Bool {
        text.range(
            of: "\\b\(NSRegularExpression.escapedPattern(for: word))\\b",
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }
}

private struct MonthDay: Hashable {
    let month: Int
    let day: Int
}
