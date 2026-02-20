Feature: Lane misassignment correction

  When cars are placed in the wrong lanes during staging,
  the recorded times are physically correct per-lane but
  attributed to the wrong cars. The operator corrects the
  lane assignments without changing recorded times.

  Background:
    Given a race is in progress with a started section

  Scenario: Swap two cars that were in wrong lanes
    Given heat 4 completed with car #3 in lane 1 and car #7 in lane 2
    And car #3 recorded 3.456s and car #7 recorded 3.789s
    When the operator corrects lane assignments swapping cars #3 and #7
    Then car #7 should now be assigned to lane 1 with time 3.456s
    And car #3 should now be assigned to lane 2 with time 3.789s
    And the leaderboard should update to reflect the corrected assignments

  Scenario: Correction after advancing to next heat
    Given heat 4 was completed and heat 5 is now staged
    When the operator corrects the lane assignments for heat 4
    Then the correction should apply retroactively
    And the current staging for heat 5 should not be affected
