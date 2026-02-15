Feature: Schedule Modifications
  Car removal and late arrival mid-event trigger schedule regeneration.
  Completed heats are preserved; remaining heats are regenerated.

  Scenario: Car removal at heat 5
    Given 10 participants
    And a 6-lane track
    And no race results
    And a schedule has been generated
    And heats 1 through 5 have been completed
    When car 3 is removed
    Then no error should be thrown
    And the schedule should be valid
    And car 3 should not appear in any heat after heat 5

  Scenario: Multiple car removals
    Given 10 participants
    And a 6-lane track
    And no race results
    And a schedule has been generated
    And heats 1 through 3 have been completed
    When car 2 is removed
    Then no error should be thrown
    And car 2 should not appear in any heat after heat 3
    When car 5 is removed
    Then no error should be thrown
    And car 5 should not appear in any heat after heat 3
    And car 2 should not appear in any heat after heat 3

  Scenario: Removal leaving exactly 2 participants
    Given 3 participants
    And a 3-lane track
    And no race results
    And a schedule has been generated
    And heats 1 through 1 have been completed
    When car 2 is removed
    Then no error should be thrown
    And the schedule should be valid

  Scenario: Late arrival at heat 3
    Given 8 participants
    And a 6-lane track
    And no race results
    And a schedule has been generated
    And heats 1 through 3 have been completed
    When car 20 named 'Latecomer' arrives late
    Then no error should be thrown
    And the schedule should be valid
    And car 20 should appear in at least one heat after heat 3

  Scenario: Multiple late arrivals
    Given 6 participants
    And a 6-lane track
    And no race results
    And a schedule has been generated
    And heats 1 through 2 have been completed
    When car 10 named 'Late1' arrives late
    Then no error should be thrown
    And car 10 should appear in at least one heat after heat 2
    When car 11 named 'Late2' arrives late
    Then no error should be thrown
    And car 11 should appear in at least one heat after heat 2

  Scenario: Combined removal and late arrival
    Given 10 participants
    And a 6-lane track
    And no race results
    And a schedule has been generated
    And heats 1 through 4 have been completed
    When car 3 is removed
    Then no error should be thrown
    And car 3 should not appear in any heat after heat 4
    When car 20 named 'NewCar' arrives late
    Then no error should be thrown
    And car 20 should appear in at least one heat after heat 4
    And car 3 should not appear in any heat after heat 4

  Scenario: Completed heats are preserved after removal
    Given 10 participants
    And a 6-lane track
    And no race results
    And a schedule has been generated
    And heats 1 through 5 have been completed
    When car 3 is removed
    Then heats 1 through 5 should be unchanged

  Scenario: Completed heats are preserved after late arrival
    Given 8 participants
    And a 6-lane track
    And no race results
    And a schedule has been generated
    And heats 1 through 3 have been completed
    When car 20 named 'Latecomer' arrives late
    Then heats 1 through 3 should be unchanged
