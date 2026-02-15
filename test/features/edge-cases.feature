Feature: Edge Cases
  Error cases and boundary conditions for the heat scheduler.

  Scenario: Zero participants throws error
    Given 0 participants
    And a 6-lane track
    When a schedule is generated
    Then an error should be thrown with message "at least 2 participants"

  Scenario: One participant throws error
    Given 1 participants
    And a 6-lane track
    When a schedule is generated
    Then an error should be thrown with message "at least 2 participants"

  Scenario: Exactly 2 participants on 6 lanes
    Given 2 participants
    And a 6-lane track
    And no race results
    When a schedule is generated
    Then no error should be thrown
    And the schedule should be valid
    And every heat should have at least 2 cars
    And every heat should have at most 2 cars
    And lane balance should be within 1

  Scenario: Fewer participants than lanes
    Given 4 participants
    And a 6-lane track
    And no race results
    When a schedule is generated
    Then no error should be thrown
    And the schedule should be valid
    And every heat should have at most 4 cars
    And lane balance should be within 1

  Scenario: 3-lane track
    Given 10 participants
    And a 3-lane track
    And no race results
    When a schedule is generated
    Then no error should be thrown
    And the schedule should be valid
    And every heat should have at most 3 cars
    And lane balance should be within 1
