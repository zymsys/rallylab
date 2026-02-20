Feature: Late check-in on race day

  A participant already on the roster fails to check in before
  the section starts. When they arrive mid-race, catch-up heats
  are generated for rounds they missed.

  Background:
    Given a race is in progress with a started section

  Scenario: Late check-in triggers catch-up heats
    Given "Tardy Tina" is registered but not checked in
    And 3 group heats have been completed
    When "Tardy Tina" checks in
    Then 3 solo catch-up heats should be inserted for "Tardy Tina"
    And the catch-up heats cycle through available lanes
    And "Tardy Tina" should appear in the remaining group heats

  Scenario: Multiple late arrivals get sequential catch-up heats
    Given "Tardy Tina" and "Slow Sam" are registered but not checked in
    And 2 group heats have been completed
    When "Tardy Tina" checks in
    And "Slow Sam" checks in
    Then "Tardy Tina" should have 2 catch-up heats
    And "Slow Sam" should have 2 catch-up heats
    And all catch-up heats should appear before remaining group heats
