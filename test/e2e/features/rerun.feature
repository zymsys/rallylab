Feature: Heat re-run

  When a heat result is disputed or a malfunction occurs,
  the operator declares a re-run. The heat is re-staged and
  the new result supersedes the previous one.

  Background:
    Given a race is in progress with a started section

  Scenario: Re-run supersedes previous result
    Given heat 2 has just completed with results
    When the operator declares a re-run
    Then the display should return to staging for heat 2
    And when the heat completes again with new times
    Then the new result should replace the previous result
    And the leaderboard should reflect only the new times

  Scenario: Multiple re-runs of the same heat
    Given heat 2 has just completed with results
    When the operator declares a re-run
    And the heat completes again
    And the operator declares another re-run
    And the heat completes a third time
    Then only the final result should be used for scoring
