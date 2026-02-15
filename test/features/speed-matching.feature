Feature: Speed Matching
  After initial heats, participants are grouped by average time
  so faster cars race together for more exciting competition.

  Scenario: Fast and slow participants are grouped separately
    Given the following participants:
      | car_number | name    |
      | 1          | Fast1   |
      | 2          | Fast2   |
      | 3          | Fast3   |
      | 4          | Fast4   |
      | 5          | Fast5   |
      | 6          | Fast6   |
      | 7          | Slow1   |
      | 8          | Slow2   |
      | 9          | Slow3   |
      | 10         | Slow4   |
      | 11         | Slow5   |
      | 12         | Slow6   |
    And a 6-lane track
    And the following race results:
      | type          | heat | lane_1_ms | lane_2_ms | lane_3_ms | lane_4_ms | lane_5_ms | lane_6_ms | timestamp | lanes                                                                                                                                                                                |
      | RaceCompleted | 1    | 2000      | 2100      | 2200      | 2300      | 2400      | 2500      | 1000      | [{"car_number":1},{"car_number":2},{"car_number":3},{"car_number":4},{"car_number":5},{"car_number":6}]       |
      | RaceCompleted | 2    | 4000      | 4100      | 4200      | 4300      | 4400      | 4500      | 2000      | [{"car_number":7},{"car_number":8},{"car_number":9},{"car_number":10},{"car_number":11},{"car_number":12}]   |
    When a schedule is generated
    Then no error should be thrown
    And the metadata should show algorithm 'speed_matched_greedy'
    And the metadata should show speed_matched is 'true'
    And the schedule should be valid

  Scenario: Participants with no results are in slowest group
    Given the following participants:
      | car_number | name       |
      | 1          | Fast1      |
      | 2          | Fast2      |
      | 3          | Fast3      |
      | 4          | Fast4      |
      | 5          | Fast5      |
      | 6          | Fast6      |
      | 7          | NoResult1  |
      | 8          | NoResult2  |
      | 9          | NoResult3  |
      | 10         | NoResult4  |
      | 11         | NoResult5  |
      | 12         | NoResult6  |
    And a 6-lane track
    And the following race results:
      | type          | heat | lane_1_ms | lane_2_ms | lane_3_ms | lane_4_ms | lane_5_ms | lane_6_ms | timestamp | lanes                                                                                                                                                                                |
      | RaceCompleted | 1    | 2000      | 2100      | 2200      | 2300      | 2400      | 2500      | 1000      | [{"car_number":1},{"car_number":2},{"car_number":3},{"car_number":4},{"car_number":5},{"car_number":6}]       |
    When a schedule is generated
    Then no error should be thrown
    And participants with no results should be in the slowest group
    And the schedule should be valid

  Scenario: Manual rank results used as speed proxy
    Given the following participants:
      | car_number | name    |
      | 1          | Fast1   |
      | 2          | Medium1 |
      | 3          | Slow1   |
      | 4          | Fast2   |
      | 5          | Medium2 |
      | 6          | Slow2   |
    And a 3-lane track
    And the following race results:
      | type                   | heat | rankings                                                                                     | timestamp |
      | ResultManuallyEntered  | 1    | [{"place":1,"lane":1,"car_number":1},{"place":2,"lane":2,"car_number":2},{"place":3,"lane":3,"car_number":3}] | 1000      |
      | ResultManuallyEntered  | 2    | [{"place":1,"lane":1,"car_number":4},{"place":2,"lane":2,"car_number":5},{"place":3,"lane":3,"car_number":6}] | 2000      |
    When a schedule is generated
    Then no error should be thrown
    And the metadata should show speed_matched is 'true'
    And the schedule should be valid

  Scenario: Superseded results are excluded
    Given the following participants:
      | car_number | name  |
      | 1          | Car1  |
      | 2          | Car2  |
      | 3          | Car3  |
      | 4          | Car4  |
      | 5          | Car5  |
      | 6          | Car6  |
    And a 6-lane track
    And the following race results:
      | type          | heat | lane_1_ms | lane_2_ms | lane_3_ms | lane_4_ms | lane_5_ms | lane_6_ms | timestamp | lanes                                                                                                                                                                        |
      | RaceCompleted | 1    | 9999      | 9999      | 9999      | 9999      | 9999      | 9999      | 1000      | [{"car_number":1},{"car_number":2},{"car_number":3},{"car_number":4},{"car_number":5},{"car_number":6}] |
      | RaceCompleted | 1    | 2000      | 2100      | 2200      | 2300      | 2400      | 2500      | 2000      | [{"car_number":1},{"car_number":2},{"car_number":3},{"car_number":4},{"car_number":5},{"car_number":6}] |
    When a schedule is generated
    Then no error should be thrown
    And the schedule should be valid

  Scenario: Speed matching disabled via option
    Given 10 participants
    And a 6-lane track
    And speed matching is disabled
    And the following race results:
      | type          | heat | lane_1_ms | lane_2_ms | lane_3_ms | lane_4_ms | lane_5_ms | lane_6_ms | timestamp | lanes                                                                                                                                                                        |
      | RaceCompleted | 1    | 2150      | 2320      | 2401      | 3010      | 2875      | 2601      | 1000      | [{"car_number":1},{"car_number":2},{"car_number":3},{"car_number":4},{"car_number":5},{"car_number":6}] |
    When a schedule is generated
    Then no error should be thrown
    And the metadata should show algorithm 'greedy_heuristic'
    And the metadata should show speed_matched is 'false'
