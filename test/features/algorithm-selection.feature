Feature: Algorithm Selection
  The scheduler auto-selects the best algorithm based on roster size,
  lane count, and whether results exist.

  Scenario: Circle method for known solvable size without results
    Given 6 participants
    And a 6-lane track
    And no race results
    When the algorithm is selected
    Then the selected algorithm should be 'circle_method'

  Scenario: Circle method for N=L+1 without results
    Given 7 participants
    And a 6-lane track
    And no race results
    When the algorithm is selected
    Then the selected algorithm should be 'circle_method'

  Scenario: Circle method for power of 2 without results
    Given 16 participants
    And a 6-lane track
    And no race results
    When the algorithm is selected
    Then the selected algorithm should be 'circle_method'

  Scenario: Greedy heuristic for non-solvable size without results
    Given 10 participants
    And a 6-lane track
    And no race results
    When the algorithm is selected
    Then the selected algorithm should be 'greedy_heuristic'

  Scenario: Greedy heuristic for 15 participants without results
    Given 15 participants
    And a 6-lane track
    And no race results
    When the algorithm is selected
    Then the selected algorithm should be 'greedy_heuristic'

  Scenario: Speed matched greedy when results exist
    Given 10 participants
    And a 6-lane track
    And the following race results:
      | type          | heat | lane_1_ms | lane_2_ms | lane_3_ms | lane_4_ms | lane_5_ms | lane_6_ms | timestamp |
      | RaceCompleted | 1    | 2150      | 2320      | 2401      | 3010      | 2875      | 2601      | 1000      |
    When the algorithm is selected
    Then the selected algorithm should be 'speed_matched_greedy'

  Scenario: Greedy heuristic when results exist but speed matching disabled
    Given 10 participants
    And a 6-lane track
    And speed matching is disabled
    And the following race results:
      | type          | heat | lane_1_ms | lane_2_ms | lane_3_ms | lane_4_ms | lane_5_ms | lane_6_ms | timestamp |
      | RaceCompleted | 1    | 2150      | 2320      | 2401      | 3010      | 2875      | 2601      | 1000      |
    When the algorithm is selected
    Then the selected algorithm should be 'greedy_heuristic'

  Scenario: isKnownSolvable for various sizes
    When isKnownSolvable is checked for 6 participants and 6 lanes
    Then the result should be 'true'

  Scenario: isKnownSolvable returns false for non-solvable
    When isKnownSolvable is checked for 10 participants and 6 lanes
    Then the result should be 'false'

  Scenario: isKnownSolvable for N=L
    When isKnownSolvable is checked for 3 participants and 3 lanes
    Then the result should be 'true'

  Scenario: isKnownSolvable for power of 2
    When isKnownSolvable is checked for 64 participants and 6 lanes
    Then the result should be 'true'
