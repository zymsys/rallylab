Feature: Circle Method
  The circle method provides perfect lane balance for known solvable roster sizes.
  Every participant runs each lane exactly once.

  Background:
    Given no race results

  Scenario: 6 participants on 6 lanes (trivial perfect)
    Given 6 participants
    And a 6-lane track
    When a schedule is generated
    Then no error should be thrown
    And the schedule should be valid
    And lane balance should be perfect
    And the metadata should show algorithm 'circle_method'
    And the metadata should show lane_balance_perfect is 'true'
    And each participant should race exactly 6 times

  Scenario: 7 participants on 6 lanes (known solvable, odd)
    Given 7 participants
    And a 6-lane track
    When a schedule is generated
    Then no error should be thrown
    And the schedule should be valid
    And lane balance should be perfect
    And the metadata should show algorithm 'circle_method'
    And each participant should race exactly 6 times

  Scenario: 8 participants on 6 lanes (known solvable)
    Given 8 participants
    And a 6-lane track
    When a schedule is generated
    Then no error should be thrown
    And the schedule should be valid
    And lane balance should be perfect
    And each participant should race exactly 6 times

  Scenario: 12 participants on 6 lanes (known solvable)
    Given 12 participants
    And a 6-lane track
    When a schedule is generated
    Then no error should be thrown
    And the schedule should be valid
    And lane balance should be perfect
    And each participant should race exactly 6 times

  Scenario: 32 participants on 6 lanes (power of 2)
    Given 32 participants
    And a 6-lane track
    When a schedule is generated
    Then no error should be thrown
    And the schedule should be valid
    And lane balance should be perfect
    And each participant should race exactly 6 times

  Scenario: Bye handling for odd participant count
    Given 7 participants
    And a 6-lane track
    When a schedule is generated
    Then no error should be thrown
    And all participants should appear in the schedule
    And no participant appears twice in the same heat

  Scenario Outline: All known solvable sizes use circle method
    Given <count> participants
    And a 6-lane track
    When a schedule is generated
    Then the metadata should show algorithm 'circle_method'
    And lane balance should be perfect

    Examples:
      | count |
      | 6     |
      | 7     |
      | 8     |
      | 12    |
      | 16    |
      | 18    |
      | 24    |
      | 32    |
