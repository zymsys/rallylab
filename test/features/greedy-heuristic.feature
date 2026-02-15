Feature: Greedy Heuristic
  The greedy heuristic is the fallback algorithm for non-solvable roster sizes.
  It guarantees lane balance within 1 for every participant.

  Background:
    Given no race results

  Scenario: 10 participants on 6 lanes
    Given 10 participants
    And a 6-lane track
    When a schedule is generated
    Then no error should be thrown
    And the schedule should be valid
    And all participants should appear in the schedule
    And lane balance should be within 1
    And no participant appears twice in the same heat
    And the schedule should have metadata
    And the metadata should show lane_balance_perfect is 'false'

  Scenario: 15 participants on 6 lanes
    Given 15 participants
    And a 6-lane track
    When a schedule is generated
    Then no error should be thrown
    And the schedule should be valid
    And all participants should appear in the schedule
    And lane balance should be within 1
    And no participant appears twice in the same heat

  Scenario: 50 participants on 6 lanes
    Given 50 participants
    And a 6-lane track
    When a schedule is generated
    Then no error should be thrown
    And the schedule should be valid
    And all participants should appear in the schedule
    And lane balance should be within 1
    And no participant appears twice in the same heat

  Scenario: Each participant races the correct number of times
    Given 10 participants
    And a 6-lane track
    When a schedule is generated
    Then each participant should race exactly 6 times

  Scenario: 15 participants each race 6 times
    Given 15 participants
    And a 6-lane track
    When a schedule is generated
    Then each participant should race exactly 6 times

  Scenario: Named participants preserve car numbers and names
    Given the following participants:
      | car_number | name    |
      | 3          | Tommy   |
      | 7          | Alice   |
      | 1          | Billy   |
      | 5          | Emma    |
      | 2          | Sarah   |
      | 8          | Jake    |
      | 10         | Mia     |
      | 12         | Leo     |
      | 15         | Zara    |
      | 20         | Noah    |
    And a 6-lane track
    When a schedule is generated
    Then no error should be thrown
    And all participants should appear in the schedule
    And lane balance should be within 1
