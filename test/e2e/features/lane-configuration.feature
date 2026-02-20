Feature: Non-adjacent lane configuration

  Scout Trucks are wider and require alternate lanes. The operator
  configures available lanes as a non-contiguous set (e.g., [1, 3, 5])
  and the scheduler uses only those physical lanes.

  Background:
    Given an event with a Scout Trucks section

  Scenario: Start section with 3 non-adjacent lanes
    Given 6 participants are checked in for Scout Trucks
    When the operator starts the section with lanes 1, 3, and 5
    Then all staged heats should only use lanes 1, 3, and 5
    And each heat should have at most 3 cars
    And the schedule should provide balanced lane assignments

  Scenario: Change lanes mid-section
    Given Scout Trucks is racing with lanes 1, 3, and 5
    And 2 heats have been completed
    When the operator changes available lanes to 1 and 5
    Then completed heats should be preserved unchanged
    And remaining heats should be regenerated for 2 lanes
    And each remaining heat should have at most 2 cars

  Scenario: Lane change during staging restages current heat
    Given Scout Trucks is in the staging state for heat 3
    When the operator changes available lanes to 1, 3, 5, and 7
    Then heat 3 should be restaged with the new lane set
